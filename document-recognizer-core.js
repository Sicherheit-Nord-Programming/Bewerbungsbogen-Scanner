export const SUPPORTED_DOCUMENT_SLOTS = Object.freeze([
  'id-front',
  'id-back',
  'passport-data',
  'health-front',
  'health-back',
  'tax-id',
]);

const SLOT_ALIASES = Object.freeze({
  front: 'id-front',
  back: 'id-back',
  'identity-front': 'id-front',
  'identity-back': 'id-back',
});

const SLOT_THRESHOLDS = Object.freeze({
  'id-front': 8,
  'id-back': 10,
  'passport-data': 10,
  'health-front': 9,
  'health-back': 11,
  'tax-id': 12,
});

const MIN_EXPLICIT_OCR_CONFIDENCE = 8;
const MRZ_WEIGHTS = Object.freeze([7, 3, 1]);
const MRZ_REPLACEMENTS = Object.freeze({
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  G: '6',
  B: '8',
});

function canonicalSlot(slot) {
  const normalized = String(slot ?? '')
    .trim()
    .toLowerCase();
  return SLOT_ALIASES[normalized] || normalized;
}

export function normalizeOcrText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/ß/gu, 'SS')
    .toUpperCase()
    .replace(/[’‘`´]/gu, "'")
    .replace(/[^A-Z0-9<>'\n\r.:/\-\s]/gu, ' ')
    .replace(/[\t\f\v]+/gu, ' ')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ ]{2,}/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}

function compactText(value) {
  return normalizeOcrText(value).replace(/[^A-Z0-9]/gu, '');
}

function boundedLevenshtein(left, right, maximum) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1] +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const value = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function approximatelyContains(text, anchor) {
  const haystack = compactText(text);
  const needle = compactText(anchor);
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length < 7 || haystack.length < needle.length - 2) return false;

  const maximum = needle.length <= 12 ? 1 : needle.length <= 24 ? 2 : 3;
  const minimumWindow = Math.max(1, needle.length - maximum);
  const maximumWindow = Math.min(haystack.length, needle.length + maximum);
  for (
    let windowLength = minimumWindow;
    windowLength <= maximumWindow;
    windowLength += 1
  ) {
    for (let start = 0; start + windowLength <= haystack.length; start += 1) {
      if (
        boundedLevenshtein(
          haystack.slice(start, start + windowLength),
          needle,
          maximum,
        ) <= maximum
      ) {
        return true;
      }
    }
  }
  return false;
}

function matchesAny(text, anchors) {
  return anchors.some((anchor) => approximatelyContains(text, anchor));
}

function countAnchorGroups(text, groups) {
  return groups.reduce(
    (count, anchors) => count + (matchesAny(text, anchors) ? 1 : 0),
    0,
  );
}

function exactSearchText(value) {
  const normalized = normalizeOcrText(value)
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim();
  return normalized ? ` ${normalized} ` : '';
}

function exactlyContains(text, anchor) {
  const haystack = exactSearchText(text);
  const needle = exactSearchText(anchor).trim();
  return Boolean(haystack && needle && haystack.includes(` ${needle} `));
}

function matchesAnyExact(text, anchors) {
  return anchors.some((anchor) => exactlyContains(text, anchor));
}

function tsvNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOcrTsvLines(tsv, width, height) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return Object.freeze([]);
  }

  const rows = String(tsv ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n');
  const groups = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const columns = rows[index].split('\t');
    if (columns.length < 12 || columns[0] !== '5') continue;
    const left = tsvNumber(columns[6]);
    const top = tsvNumber(columns[7]);
    const boxWidth = tsvNumber(columns[8]);
    const boxHeight = tsvNumber(columns[9]);
    const confidence = tsvNumber(columns[10]);
    const text = columns.slice(11).join('\t').trim();
    if (
      left === null ||
      top === null ||
      boxWidth === null ||
      boxHeight === null ||
      confidence === null ||
      confidence < 0 ||
      boxWidth <= 0 ||
      boxHeight <= 0 ||
      !text
    ) {
      continue;
    }
    const key = columns.slice(1, 5).join(':');
    const existing = groups.get(key) || {
      words: [],
      left,
      top,
      right: left + boxWidth,
      bottom: top + boxHeight,
      confidenceTotal: 0,
      confidenceCount: 0,
    };
    existing.words.push({ left, text });
    existing.left = Math.min(existing.left, left);
    existing.top = Math.min(existing.top, top);
    existing.right = Math.max(existing.right, left + boxWidth);
    existing.bottom = Math.max(existing.bottom, top + boxHeight);
    existing.confidenceTotal += confidence;
    existing.confidenceCount += 1;
    groups.set(key, existing);
  }

  const lines = [...groups.values()]
    .map((line) => ({
      text: line.words
        .sort((left, right) => left.left - right.left)
        .map(({ text }) => text)
        .join(' '),
      x: Math.max(0, Math.min(1, line.left / imageWidth)),
      y: Math.max(0, Math.min(1, line.top / imageHeight)),
      width: Math.max(0, Math.min(1, (line.right - line.left) / imageWidth)),
      height: Math.max(0, Math.min(1, (line.bottom - line.top) / imageHeight)),
      confidence:
        line.confidenceCount > 0
          ? line.confidenceTotal / line.confidenceCount
          : 0,
    }))
    .filter((line) => normalizeOcrText(line.text))
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .slice(0, 80);
  return Object.freeze(lines.map((line) => Object.freeze(line)));
}

function normalizeMrzLine(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[«‹›>]/gu, '<')
    .replace(/\s/gu, '<')
    .replace(/[^A-Z0-9<]/gu, '');
}

function mrzCharacterValue(character) {
  if (/^[0-9]$/u.test(character)) return Number(character);
  if (/^[A-Z]$/u.test(character)) return character.charCodeAt(0) - 55;
  if (character === '<') return 0;
  return null;
}

export function mrzCheckDigit(value) {
  const normalized = normalizeMrzLine(value);
  let total = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const characterValue = mrzCharacterValue(normalized[index]);
    if (characterValue === null) return null;
    total += characterValue * MRZ_WEIGHTS[index % MRZ_WEIGHTS.length];
  }
  return String(total % 10);
}

function coerceMrzDigit(character) {
  if (/^[0-9]$/u.test(character)) return character;
  return MRZ_REPLACEMENTS[character] || character;
}

function coercePositions(line, positions) {
  const characters = [...line];
  for (const position of positions) {
    if (position >= 0 && position < characters.length) {
      characters[position] = coerceMrzDigit(characters[position]);
    }
  }
  return characters.join('');
}

function positionsBetween(start, endInclusive) {
  return Array.from(
    { length: endInclusive - start + 1 },
    (_, index) => start + index,
  );
}

function mrzLineCandidates(source, length) {
  const rawLines = Array.isArray(source)
    ? source
    : String(source ?? '')
        .replace(/\r\n?/gu, '\n')
        .split('\n');
  const candidates = [];
  for (const rawLine of rawLines) {
    const line = normalizeMrzLine(rawLine);
    if (line.length < length) continue;
    if (line.length === length) {
      candidates.push(line);
      continue;
    }
    for (let start = 0; start + length <= line.length; start += 1) {
      candidates.push(line.slice(start, start + length));
    }
  }
  return [...new Set(candidates)];
}

function matchingCheckDigit(value, candidate) {
  return /^[0-9]$/u.test(candidate) && mrzCheckDigit(value) === candidate;
}

export function validateTd3Mrz(source) {
  const lines = mrzLineCandidates(source, 44);
  for (let firstIndex = 0; firstIndex < lines.length; firstIndex += 1) {
    const line1 = lines[firstIndex];
    const issuingState = line1.slice(2, 5);
    if (
      line1[0] !== 'P' ||
      !/^[A-Z<]$/u.test(line1[1]) ||
      !/^[A-Z<]{3}$/u.test(issuingState)
    ) {
      continue;
    }
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < lines.length;
      secondIndex += 1
    ) {
      let line2 = lines[secondIndex];
      line2 = coercePositions(line2, [
        ...positionsBetween(9, 9),
        ...positionsBetween(13, 19),
        ...positionsBetween(21, 27),
        ...positionsBetween(42, 43),
      ]);
      const checks = {
        documentNumber: matchingCheckDigit(line2.slice(0, 9), line2[9]),
        birthDate: matchingCheckDigit(line2.slice(13, 19), line2[19]),
        expiryDate: matchingCheckDigit(line2.slice(21, 27), line2[27]),
        personalNumber: matchingCheckDigit(line2.slice(28, 42), line2[42]),
        composite: matchingCheckDigit(
          `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`,
          line2[43],
        ),
      };
      if (
        checks.documentNumber &&
        checks.birthDate &&
        checks.expiryDate &&
        checks.composite
      ) {
        return Object.freeze({
          valid: true,
          type: 'TD3',
          issuingState,
          documentNumber: line2.slice(0, 9).replace(/<+$/u, ''),
          birthDate: line2.slice(13, 19),
          expiryDate: line2.slice(21, 27),
          checks: Object.freeze(checks),
        });
      }
    }
  }
  return Object.freeze({ valid: false, type: 'TD3' });
}

export function validateTd1Mrz(source) {
  const lines = mrzLineCandidates(source, 30);
  for (let firstIndex = 0; firstIndex < lines.length; firstIndex += 1) {
    let line1 = lines[firstIndex];
    const germanIdentityPrefix =
      (line1.slice(0, 2) === 'ID' && line1.slice(2, 5) === 'D<<') ||
      ((line1.slice(0, 2) === 'I<' || line1.slice(0, 2) === 'ID') &&
        line1.slice(2, 5) === 'DEU');
    if (!germanIdentityPrefix) continue;
    line1 = coercePositions(line1, [14]);

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < lines.length;
      secondIndex += 1
    ) {
      let line2 = lines[secondIndex];
      line2 = coercePositions(line2, [
        ...positionsBetween(0, 6),
        ...positionsBetween(8, 14),
        29,
      ]);
      const checks = {
        documentNumber: matchingCheckDigit(line1.slice(5, 14), line1[14]),
        birthDate: matchingCheckDigit(line2.slice(0, 6), line2[6]),
        expiryDate: matchingCheckDigit(line2.slice(8, 14), line2[14]),
        composite: matchingCheckDigit(
          `${line1.slice(5, 30)}${line2.slice(0, 7)}${line2.slice(8, 15)}${line2.slice(18, 29)}`,
          line2[29],
        ),
      };
      if (
        checks.documentNumber &&
        checks.birthDate &&
        checks.expiryDate &&
        checks.composite
      ) {
        return Object.freeze({
          valid: true,
          type: 'TD1',
          issuingState: 'DEU',
          documentNumber: line1.slice(5, 14).replace(/<+$/u, ''),
          birthDate: line2.slice(0, 6),
          expiryDate: line2.slice(8, 14),
          checks: Object.freeze(checks),
        });
      }
    }
  }
  return Object.freeze({ valid: false, type: 'TD1' });
}

export function normalizeGermanTaxId(value) {
  const raw = String(value ?? '');
  if (/[^0-9\s\u00a0\u2009\u202f-]/u.test(raw)) return null;
  return raw.replace(/[\s\u00a0\u2009\u202f-]/gu, '');
}

export function isPlausibleGermanTaxId(value) {
  const normalized = normalizeGermanTaxId(value);
  if (!normalized || !/^[1-9][0-9]{10}$/u.test(normalized)) return false;

  const firstTen = normalized.slice(0, 10);
  const counts = Array.from({ length: 10 }, () => 0);
  for (const digit of firstTen) counts[Number(digit)] += 1;
  const repeated = counts
    .map((count, digit) => ({ count, digit }))
    .filter(({ count }) => count === 2 || count === 3);
  if (repeated.length !== 1) return false;
  if (
    counts.some(
      (count, digit) =>
        digit !== repeated[0].digit && count !== 0 && count !== 1,
    )
  ) {
    return false;
  }
  const absentDigits = counts.filter((count) => count === 0).length;
  if (
    (repeated[0].count === 2 && absentDigits !== 1) ||
    (repeated[0].count === 3 && absentDigits !== 2)
  ) {
    return false;
  }
  if (
    repeated[0].count === 3 &&
    firstTen.includes(String(repeated[0].digit).repeat(2))
  ) {
    return false;
  }

  let product = 10;
  for (const digit of firstTen) {
    let sum = (Number(digit) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  let checkDigit = 11 - product;
  if (checkDigit === 10) checkDigit = 0;
  return checkDigit === Number(normalized[10]);
}

export function extractPlausibleGermanTaxIds(value) {
  const text = String(value ?? '');
  const matches = [
    ...text.matchAll(/(?:^|[^\d])((?:\d[\s\u00a0\u2009\u202f-]*){11})(?!\d)/gu),
  ].map((match) => match[1]);
  return [
    ...new Set(
      matches
        .map((match) => normalizeGermanTaxId(match))
        .filter((candidate) => isPlausibleGermanTaxId(candidate)),
    ),
  ];
}

function normalizeLayoutLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 80)
    .map((line, index) => {
      const text = normalizeOcrText(line?.text).replace(/\n/gu, ' ').trim();
      const x = Number(line?.x);
      const y = Number(line?.y);
      const width = Number(line?.width);
      const height = Number(line?.height);
      if (
        !text ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x + width > 1.02 ||
        y + height > 1.02
      ) {
        return null;
      }
      return {
        index,
        text,
        x,
        y,
        width,
        height,
        centerY: y + height / 2,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function compactCardLine(line, maximumCharacters = 58) {
  if (!line || line.text.length > maximumCharacters) return false;
  return line.text.split(/\s+/u).filter(Boolean).length <= 9;
}

const IDENTITY_FIELD_GROUPS = Object.freeze([
  Object.freeze({
    key: 'name',
    anchors: Object.freeze(['NAME', 'SURNAME', 'NOM']),
  }),
  Object.freeze({
    key: 'given-names',
    anchors: Object.freeze(['VORNAMEN', 'GIVEN NAMES', 'PRENOMS']),
  }),
  Object.freeze({
    key: 'birth-date',
    anchors: Object.freeze([
      'GEBURTSTAG',
      'DATE OF BIRTH',
      'DATE DE NAISSANCE',
    ]),
  }),
  Object.freeze({
    key: 'nationality',
    anchors: Object.freeze([
      'STAATSANGEHOERIGKEIT',
      'NATIONALITY',
      'NATIONALITE',
    ]),
  }),
]);

const FIELD_LABEL_TOKENS = new Set([
  'NAME',
  'SURNAME',
  'NOM',
  'VORNAMEN',
  'GIVEN',
  'NAMES',
  'PRENOMS',
  'GEBURTSTAG',
  'DATE',
  'OF',
  'BIRTH',
  'DE',
  'NAISSANCE',
  'STAATSANGEHOERIGKEIT',
  'NATIONALITY',
  'NATIONALITE',
]);

function dateValuePresent(text) {
  const compact = normalizeOcrText(text).replace(/\s/gu, '');
  return /(?:^|[^0-9])(?:[0-3][0-9][.\-/]?[01][0-9][.\-/]?(?:19|20)?[0-9]{2})(?:[^0-9]|$)/u.test(
    compact,
  );
}

function alphabeticValuePresent(text) {
  return normalizeOcrText(text)
    .split(/[^A-Z]+/u)
    .some((token) => token.length >= 3 && !FIELD_LABEL_TOKENS.has(token));
}

function nationalityValuePresent(text) {
  const normalized = exactSearchText(text);
  return (
    ['DEUTSCH', 'GERMAN', 'ALLEMANDE', 'DEU'].some((value) =>
      normalized.includes(` ${value} `),
    ) || /\s[A-Z]{3}\s/u.test(normalized)
  );
}

function fieldValuePresent(key, text) {
  if (key === 'birth-date') return dateValuePresent(text);
  if (key === 'nationality') return nationalityValuePresent(text);
  return alphabeticValuePresent(text);
}

function structuredIdentityRows(lines) {
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!compactCardLine(line, 54)) continue;
    const matchingGroups = IDENTITY_FIELD_GROUPS.filter(({ anchors }) =>
      matchesAny(line.text, anchors),
    );
    if (matchingGroups.length !== 1) continue;
    const group = matchingGroups[0];
    let valueText = line.text;
    let endIndex = index;
    const next = lines[index + 1];
    if (
      !fieldValuePresent(group.key, valueText) &&
      next &&
      compactCardLine(next, 40) &&
      next.centerY > line.centerY &&
      next.centerY - line.centerY <= 0.11 &&
      IDENTITY_FIELD_GROUPS.every(
        ({ anchors }) => !matchesAny(next.text, anchors),
      )
    ) {
      valueText = `${valueText} ${next.text}`;
      endIndex = index + 1;
    }
    if (!fieldValuePresent(group.key, valueText)) continue;
    rows.push({ key: group.key, index, endIndex, centerY: line.centerY });
  }
  return rows;
}

function identityFrontLayoutEvidence(layout) {
  const lines = normalizeLayoutLines(layout);
  const titleLines = lines.filter(
    (line) =>
      compactCardLine(line) &&
      matchesAny(line.text, [
        'PERSONALAUSWEIS',
        'IDENTITY CARD',
        "CARTE D'IDENTITE",
      ]),
  );
  const federalLines = lines.filter(
    (line) =>
      compactCardLine(line) &&
      matchesAny(line.text, [
        'BUNDESREPUBLIK DEUTSCHLAND',
        'FEDERAL REPUBLIC OF GERMANY',
      ]),
  );
  if (titleLines.length === 0 || federalLines.length === 0) return false;

  const headerY = Math.min(
    ...titleLines.map(({ centerY }) => centerY),
    ...federalLines.map(({ centerY }) => centerY),
  );
  if (headerY > 0.55) return false;
  const rows = structuredIdentityRows(lines).filter(
    ({ centerY }) => centerY >= headerY + 0.035,
  );
  const distinctFields = new Set(rows.map(({ key }) => key));
  const distinctLines = new Set(rows.map(({ index }) => index));
  return (
    distinctFields.size >= 2 &&
    distinctLines.size >= 2 &&
    distinctFields.has('birth-date') &&
    Math.max(...rows.map(({ centerY }) => centerY)) - headerY >= 0.12
  );
}

function healthNumberPresent(text) {
  const normalized = normalizeOcrText(text)
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim();
  return /(?:^|\s)[A-Z](?:\s*[0-9]){9}(?:\s|$)/u.test(normalized);
}

function healthFrontLayoutEvidence(layout) {
  const lines = normalizeLayoutLines(layout);
  const titleLines = lines.filter(
    (line) =>
      compactCardLine(line) &&
      matchesAnyExact(line.text, [
        'GESUNDHEITSKARTE',
        'ELEKTRONISCHE GESUNDHEITSKARTE',
      ]),
  );
  if (titleLines.length === 0) return false;
  const titleY = Math.min(...titleLines.map(({ centerY }) => centerY));
  if (titleY > 0.6) return false;

  let numberRow = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      !compactCardLine(line, 52) ||
      !matchesAnyExact(line.text, [
        'VERSICHERTENNUMMER',
        'KRANKENVERSICHERTENNUMMER',
      ])
    ) {
      continue;
    }
    const next = lines[index + 1];
    const valueText =
      next &&
      compactCardLine(next, 32) &&
      next.centerY - line.centerY > 0 &&
      next.centerY - line.centerY <= 0.1
        ? `${line.text} ${next.text}`
        : line.text;
    if (healthNumberPresent(valueText)) {
      numberRow = { index, centerY: line.centerY };
      break;
    }
  }
  if (!numberRow || numberRow.centerY < titleY + 0.035) return false;

  const supportingRows = lines.filter((line, index) => {
    if (index === numberRow.index || !compactCardLine(line, 48)) return false;
    const hasDate =
      matchesAnyExact(line.text, ['GEBURTSDATUM', 'DATE OF BIRTH']) &&
      dateValuePresent(line.text);
    const hasInsurer = matchesAnyExact(line.text, [
      'KRANKENVERSICHERUNG',
      'KRANKENKASSE',
      'GESUNDHEITSKASSE',
    ]);
    const hasCarrier =
      matchesAnyExact(line.text, ['KASSENNUMMER', 'KOSTENTRAEGERKENNUNG']) &&
      /[0-9]{5,}/u.test(line.text.replace(/\s/gu, ''));
    return hasDate || hasInsurer || hasCarrier;
  });
  return (
    supportingRows.length > 0 &&
    Math.max(
      numberRow.centerY,
      ...supportingRows.map(({ centerY }) => centerY),
    ) -
      titleY >=
      0.12
  );
}

function evaluateCandidates(text, mrzText, layout) {
  const combinedText = `${text}\n${mrzText}`.trim();
  const td1 = validateTd1Mrz(combinedText);
  const td3 = validateTd3Mrz(combinedText);

  const identityTitle = matchesAny(text, [
    'PERSONALAUSWEIS',
    'IDENTITY CARD',
    "CARTE D'IDENTITE",
  ]);
  const federalIdentityHeader = matchesAny(text, [
    'BUNDESREPUBLIK DEUTSCHLAND',
    'FEDERAL REPUBLIC OF GERMANY',
  ]);
  const identityFields = countAnchorGroups(text, [
    ['NAME', 'SURNAME', 'NOM'],
    ['VORNAMEN', 'GIVEN NAMES', 'PRENOMS'],
    ['GEBURTSTAG', 'DATE OF BIRTH', 'DATE DE NAISSANCE'],
    ['STAATSANGEHOERIGKEIT', 'NATIONALITY', 'NATIONALITE'],
  ]);

  const identityLayout = identityFrontLayoutEvidence(layout);
  const healthLayout = healthFrontLayoutEvidence(layout);

  const healthFrontTitle = matchesAnyExact(text, [
    'GESUNDHEITSKARTE',
    'ELEKTRONISCHE GESUNDHEITSKARTE',
  ]);
  const healthInsuranceNumber = matchesAnyExact(text, [
    'VERSICHERTENNUMMER',
    'KRANKENVERSICHERTENNUMMER',
  ]);
  const healthInsurer = matchesAnyExact(text, [
    'KRANKENVERSICHERUNG',
    'KRANKENKASSE',
    'GESUNDHEITSKASSE',
  ]);
  const healthFrontFields = countAnchorGroups(text, [
    ['VERSICHERTER', 'VERSICHERTE'],
    ['GEBURTSDATUM', 'DATE OF BIRTH'],
    ['KASSENNUMMER', 'KOSTENTRAEGERKENNUNG'],
  ]);

  const healthBackTitle = matchesAny(text, [
    'EUROPAEISCHE KRANKENVERSICHERUNGSKARTE',
    'EUROPEAN HEALTH INSURANCE CARD',
    "CARTE EUROPEENNE D'ASSURANCE MALADIE",
    'EUROPESE ZIEKTEVERZEKERINGSKAART',
  ]);
  const healthBackFields = countAnchorGroups(text, [
    ['PERSOENLICHE KENNNUMMER', 'PERSONAL IDENTIFICATION NUMBER'],
    ['KENNNUMMER DES TRAEGERS', 'IDENTIFICATION NUMBER OF THE INSTITUTION'],
    ['KENNNUMMER DER KARTE', 'IDENTIFICATION NUMBER OF THE CARD'],
    ['ABLAUFDATUM', 'EXPIRY DATE'],
  ]);

  const taxIds = extractPlausibleGermanTaxIds(text);
  const taxAnchor = matchesAny(text, [
    'STEUERLICHE IDENTIFIKATIONSNUMMER',
    'STEUERIDENTIFIKATIONSNUMMER',
    'IDENTIFIKATIONSNUMMER',
    'STEUER ID',
    'IDNR',
  ]);
  const taxAuthority = matchesAny(text, [
    'BUNDESZENTRALAMT FUER STEUERN',
    'MITTEILUNG UEBER DIE ZUTEILUNG',
    'FINANZAMT',
  ]);

  const candidates = [
    {
      slot: 'id-front',
      score:
        (identityTitle ? 6 : 0) +
        (federalIdentityHeader ? 2 : 0) +
        Math.min(identityFields, 3),
      eligible:
        identityTitle &&
        federalIdentityHeader &&
        identityFields >= 2 &&
        identityLayout &&
        !td1.valid,
      evidence: [
        identityTitle && 'identity-title',
        federalIdentityHeader && 'german-federal-header',
        identityFields >= 1 && 'identity-fields',
        identityLayout && 'identity-card-layout',
      ].filter(Boolean),
    },
    {
      slot: 'id-back',
      score: td1.valid ? 10 : 0,
      eligible: td1.valid,
      evidence: [td1.valid && 'valid-td1-mrz'].filter(Boolean),
    },
    {
      slot: 'passport-data',
      score: td3.valid ? 10 : 0,
      eligible: td3.valid,
      evidence: [td3.valid && 'valid-td3-mrz'].filter(Boolean),
    },
    {
      slot: 'health-front',
      score:
        (healthFrontTitle ? 6 : 0) +
        (healthInsuranceNumber ? 3 : 0) +
        (healthInsurer ? 3 : 0) +
        Math.min(healthFrontFields, 2),
      eligible:
        healthFrontTitle &&
        healthInsuranceNumber &&
        healthLayout &&
        (healthInsurer || healthFrontFields >= 1) &&
        !healthBackTitle,
      evidence: [
        healthFrontTitle && 'health-card-title',
        healthInsuranceNumber && 'insurance-number-label',
        healthInsurer && 'health-insurer-label',
        healthFrontFields >= 1 && 'health-front-fields',
        healthLayout && 'health-card-layout',
      ].filter(Boolean),
    },
    {
      slot: 'health-back',
      score: (healthBackTitle ? 8 : 0) + Math.min(healthBackFields, 3) * 1.5,
      eligible: healthBackTitle && healthBackFields >= 2,
      evidence: [
        healthBackTitle && 'ehic-title',
        healthBackFields >= 2 && 'ehic-numbered-fields',
      ].filter(Boolean),
    },
    {
      slot: 'tax-id',
      score:
        (taxIds.length > 0 ? 7 : 0) +
        (taxAnchor ? 5 : 0) +
        (taxAuthority ? 2 : 0),
      eligible: taxIds.length > 0 && taxAnchor,
      evidence: [
        taxIds.length > 0 && 'valid-german-tax-id',
        taxAnchor && 'tax-id-label',
        taxAuthority && 'tax-authority',
      ].filter(Boolean),
    },
  ];

  return candidates.map((candidate) => ({
    ...candidate,
    recognized:
      candidate.eligible && candidate.score >= SLOT_THRESHOLDS[candidate.slot],
  }));
}

export function classifyRecognizedDocument(recognition, expectedSlot) {
  const expected = canonicalSlot(expectedSlot);
  if (!SUPPORTED_DOCUMENT_SLOTS.includes(expected)) {
    return Object.freeze({
      accepted: false,
      expectedSlot: expected || null,
      detectedSlot: null,
      reason: 'unsupported-slot',
      score: 0,
      evidence: Object.freeze([]),
    });
  }
  if (!recognition || recognition.error) {
    return Object.freeze({
      accepted: false,
      expectedSlot: expected,
      detectedSlot: null,
      reason: 'recognition-failed',
      score: 0,
      evidence: Object.freeze([]),
    });
  }

  const text = normalizeOcrText(recognition.text);
  const mrzText = normalizeOcrText(recognition.mrzText);
  if (!text && !mrzText) {
    return Object.freeze({
      accepted: false,
      expectedSlot: expected,
      detectedSlot: null,
      reason: 'ocr-empty',
      score: 0,
      evidence: Object.freeze([]),
    });
  }
  const confidence = Number(recognition.confidence);
  if (
    recognition.confidence !== undefined &&
    (!Number.isFinite(confidence) || confidence < MIN_EXPLICIT_OCR_CONFIDENCE)
  ) {
    return Object.freeze({
      accepted: false,
      expectedSlot: expected,
      detectedSlot: null,
      reason: 'ocr-low-confidence',
      score: 0,
      evidence: Object.freeze([]),
    });
  }

  const candidates = evaluateCandidates(text, mrzText, recognition.layout);
  const expectedCandidate = candidates.find(({ slot }) => slot === expected);
  const recognizedCandidates = candidates
    .filter(({ recognized }) => recognized)
    .sort((left, right) => right.score - left.score);
  const detected = recognizedCandidates[0] || null;
  const accepted = Boolean(
    expectedCandidate?.recognized && detected?.slot === expected,
  );
  const reason = accepted
    ? 'matched'
    : detected && detected.slot !== expected
      ? 'wrong-document'
      : 'unrecognized-document';

  return Object.freeze({
    accepted,
    expectedSlot: expected,
    detectedSlot: detected?.slot || null,
    reason,
    score: expectedCandidate?.score || 0,
    evidence: Object.freeze([...(expectedCandidate?.evidence || [])]),
  });
}

// Stable integration name used by the browser-side OCR adapter.
export function classifyDocumentText(recognition, expectedSlot) {
  return classifyRecognizedDocument(recognition, expectedSlot);
}

function clampRegion(image, region) {
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(region?.x ?? 0)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(region?.y ?? 0)));
  const width = Math.max(
    1,
    Math.min(image.width - x, Math.floor(region?.width ?? image.width - x)),
  );
  const height = Math.max(
    1,
    Math.min(image.height - y, Math.floor(region?.height ?? image.height - y)),
  );
  return { x, y, width, height };
}

function pixelLuminance(data, pixelIndex, channels) {
  if (channels === 1) return data[pixelIndex];
  const offset = pixelIndex * channels;
  return (
    data[offset] * 0.2126 +
    data[offset + 1] * 0.7152 +
    data[offset + 2] * 0.0722
  );
}

export function createDocumentVisualFingerprint(
  image,
  region,
  { columns = 8, rows = 5 } = {},
) {
  if (
    !image ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < columns ||
    image.height < rows ||
    !image.data ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2
  ) {
    return null;
  }
  const pixels = image.width * image.height;
  const channels =
    image.data.length === pixels ? 1 : image.data.length === pixels * 4 ? 4 : 0;
  if (!channels) return null;

  const bounded = clampRegion(image, region);
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const top = bounded.y + Math.floor((row * bounded.height) / rows);
    const bottom =
      bounded.y + Math.max(1, Math.floor(((row + 1) * bounded.height) / rows));
    for (let column = 0; column < columns; column += 1) {
      const left = bounded.x + Math.floor((column * bounded.width) / columns);
      const right =
        bounded.x +
        Math.max(1, Math.floor(((column + 1) * bounded.width) / columns));
      let sum = 0;
      let count = 0;
      for (
        let y = top;
        y < Math.min(bottom, bounded.y + bounded.height);
        y += 1
      ) {
        for (
          let x = left;
          x < Math.min(right, bounded.x + bounded.width);
          x += 1
        ) {
          sum += pixelLuminance(image.data, y * image.width + x, channels);
          count += 1;
        }
      }
      cells.push(count ? sum / count : 0);
    }
  }

  const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
  const variance =
    cells.reduce((sum, value) => sum + (value - mean) ** 2, 0) / cells.length;
  const contrast = Math.sqrt(variance);
  const divisor = Math.max(contrast, 1);
  const values = cells.map((value) =>
    Number(Math.max(-3, Math.min(3, (value - mean) / divisor)).toFixed(4)),
  );
  const edges = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (column + 1 < columns) edges.push(values[index + 1] - values[index]);
      if (row + 1 < rows) edges.push(values[index + columns] - values[index]);
    }
  }
  return Object.freeze({
    version: 1,
    columns,
    rows,
    contrast: Number(contrast.toFixed(4)),
    values: Object.freeze(values),
    edges: Object.freeze(edges.map((value) => Number(value.toFixed(4)))),
  });
}

// A signature deliberately contains no OCR text or document identifiers.
export function createVisualSignature(imageData, rect, options) {
  return createDocumentVisualFingerprint(imageData, rect, options);
}

function rootMeanSquareDistance(left, right) {
  if (!left.length || left.length !== right.length)
    return Number.POSITIVE_INFINITY;
  const squared = left.reduce(
    (sum, value, index) => sum + (value - right[index]) ** 2,
    0,
  );
  return Math.sqrt(squared / left.length);
}

export function documentVisualFingerprintDistance(left, right) {
  if (
    !left ||
    !right ||
    left.version !== 1 ||
    right.version !== 1 ||
    left.columns !== right.columns ||
    left.rows !== right.rows
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const toneDistance = rootMeanSquareDistance(left.values, right.values);
  const edgeDistance = rootMeanSquareDistance(left.edges, right.edges);
  return Number((toneDistance * 0.7 + edgeDistance * 0.3).toFixed(6));
}

export function visualSignatureDistance(left, right) {
  return documentVisualFingerprintDistance(left, right);
}

export function documentVisualFingerprintsMatch(
  left,
  right,
  maximumDistance = 0.42,
) {
  if (
    !left ||
    !right ||
    left.contrast < 2 ||
    right.contrast < 2 ||
    !Number.isFinite(maximumDistance) ||
    maximumDistance < 0
  ) {
    return false;
  }
  return documentVisualFingerprintDistance(left, right) <= maximumDistance;
}
