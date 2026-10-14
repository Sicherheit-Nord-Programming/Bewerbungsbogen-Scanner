import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyDocumentText,
  createVisualSignature,
  documentVisualFingerprintsMatch,
  extractPlausibleGermanTaxIds,
  isPlausibleGermanTaxId,
  mrzCheckDigit,
  parseOcrTsvLines,
  validateTd1Mrz,
  validateTd3Mrz,
  visualSignatureDistance,
} from './document-recognizer-core.js';

function cardLayout(lines) {
  return lines.map((text, index) => ({
    text,
    x: 0.08,
    y: 0.04 + index * 0.19,
    width: 0.82,
    height: 0.07,
  }));
}

function padMrz(value, length) {
  return String(value).padEnd(length, '<').slice(0, length);
}

function validTd3Mrz(issuingState = 'DEU') {
  const line1 = padMrz(`P<${issuingState}MUSTERMANN<<ERIKA`, 44);
  const documentNumber = 'C01X00T47';
  const birthDate = '900101';
  const expiryDate = '300101';
  const personalNumber = '<'.repeat(14);
  const partial =
    `${documentNumber}${mrzCheckDigit(documentNumber)}` +
    `DEU${birthDate}${mrzCheckDigit(birthDate)}` +
    `F${expiryDate}${mrzCheckDigit(expiryDate)}` +
    `${personalNumber}${mrzCheckDigit(personalNumber)}`;
  const compositeSource =
    `${partial.slice(0, 10)}${partial.slice(13, 20)}` + partial.slice(21, 43);
  const line2 = `${partial}${mrzCheckDigit(compositeSource)}`;
  assert.equal(line1.length, 44);
  assert.equal(line2.length, 44);
  return `${line1}\n${line2}`;
}

function validTd1Mrz() {
  const documentNumber = 'L01X00T47';
  const line1 =
    `IDD<<${documentNumber}${mrzCheckDigit(documentNumber)}` + '<'.repeat(15);
  const birthDate = '900101';
  const expiryDate = '300101';
  const optional = '<'.repeat(11);
  const partialLine2 =
    `${birthDate}${mrzCheckDigit(birthDate)}` +
    `F${expiryDate}${mrzCheckDigit(expiryDate)}` +
    `DEU${optional}`;
  const compositeSource =
    `${line1.slice(5, 30)}${partialLine2.slice(0, 7)}` +
    `${partialLine2.slice(8, 15)}${partialLine2.slice(18, 29)}`;
  const line2 = `${partialLine2}${mrzCheckDigit(compositeSource)}`;
  const line3 = padMrz('MUSTERMANN<<ERIKA', 30);
  assert.equal(line1.length, 30);
  assert.equal(line2.length, 30);
  return `${line1}\n${line2}\n${line3}`;
}

function validTaxId() {
  const firstTen = '1234567891';
  for (let checkDigit = 0; checkDigit <= 9; checkDigit += 1) {
    const candidate = `${firstTen}${checkDigit}`;
    if (isPlausibleGermanTaxId(candidate)) return candidate;
  }
  throw new Error('test fixture must yield a valid tax ID');
}

test('accepts a German identity-card front only in the front slot', () => {
  const recognition = {
    confidence: 72,
    text: [
      'BUNDESREPUBLIK DEUTSCHLAND',
      'PERSONALAUSWEIS / IDENTITY CARD',
      'Name / Surname MUSTERMANN',
      'Geburtstag / Date of birth 01.01.1990',
    ].join('\n'),
  };
  recognition.layout = cardLayout(recognition.text.split('\n'));

  assert.deepEqual(classifyDocumentText(recognition, 'id-front'), {
    accepted: true,
    expectedSlot: 'id-front',
    detectedSlot: 'id-front',
    reason: 'matched',
    score: 10,
    evidence: [
      'identity-title',
      'german-federal-header',
      'identity-fields',
      'identity-card-layout',
    ],
  });
  assert.equal(classifyDocumentText(recognition, 'id-back').accepted, false);
  assert.equal(
    classifyDocumentText(recognition, 'id-back').reason,
    'wrong-document',
  );
});

test('legacy front and back names map to the strict identity-card slots', () => {
  const front = classifyDocumentText(
    {
      text: 'BUNDESREPUBLIK DEUTSCHLAND\nPERSONALAUSWEIS\nNAME MUSTERMANN\nGEBURTSTAG 01.01.1990',
      confidence: 60,
      layout: cardLayout([
        'BUNDESREPUBLIK DEUTSCHLAND',
        'PERSONALAUSWEIS',
        'NAME MUSTERMANN',
        'GEBURTSTAG 01.01.1990',
      ]),
    },
    'front',
  );
  const back = classifyDocumentText(
    { mrzText: validTd1Mrz(), confidence: 60 },
    'back',
  );
  assert.equal(front.accepted, true);
  assert.equal(front.expectedSlot, 'id-front');
  assert.equal(back.accepted, true);
  assert.equal(back.expectedSlot, 'id-back');
});

test('validates TD1 checksums and rejects one changed MRZ digit', () => {
  const valid = validTd1Mrz();
  assert.equal(validateTd1Mrz(valid).valid, true);

  const lines = valid.split('\n');
  lines[1] = `${lines[1].slice(0, 8)}4${lines[1].slice(9)}`;
  assert.equal(validateTd1Mrz(lines.join('\n')).valid, false);
  assert.equal(
    classifyDocumentText(
      { mrzText: lines.join('\n'), confidence: 50 },
      'id-back',
    ).accepted,
    false,
  );
});

test('accepts a German TD1 identity-card back and rejects it as passport', () => {
  const recognition = { mrzText: validTd1Mrz(), confidence: 54 };
  const correct = classifyDocumentText(recognition, 'id-back');
  const wrong = classifyDocumentText(recognition, 'passport-data');
  assert.equal(correct.accepted, true);
  assert.equal(correct.detectedSlot, 'id-back');
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.detectedSlot, 'id-back');
  assert.equal(wrong.reason, 'wrong-document');
});

test('validates TD3 checksums and rejects one changed MRZ digit', () => {
  const valid = validTd3Mrz();
  assert.equal(validateTd3Mrz(valid).valid, true);

  const lines = valid.split('\n');
  lines[1] = `9${lines[1].slice(1)}`;
  assert.equal(validateTd3Mrz(lines.join('\n')).valid, false);
  assert.equal(
    classifyDocumentText(
      { text: 'REISEPASS PASSPORT', mrzText: lines.join('\n'), confidence: 50 },
      'passport-data',
    ).accepted,
    false,
  );
});

test('accepts a German TD3 passport data page and rejects it in other slots', () => {
  const recognition = {
    text: 'BUNDESREPUBLIK DEUTSCHLAND\nREISEPASS PASSPORT PASSEPORT',
    mrzText: validTd3Mrz(),
    confidence: 63,
  };
  const passport = classifyDocumentText(recognition, 'passport-data');
  assert.equal(passport.accepted, true);
  assert.equal(passport.detectedSlot, 'passport-data');
  assert.equal(classifyDocumentText(recognition, 'id-front').accepted, false);
  assert.equal(classifyDocumentText(recognition, 'id-back').accepted, false);
});

test('accepts a standards-compliant non-German TD3 passport', () => {
  const mrz = validTd3Mrz('GBR');
  const validation = validateTd3Mrz(mrz);
  assert.equal(validation.valid, true);
  assert.equal(validation.issuingState, 'GBR');
  assert.equal(
    classifyDocumentText({ mrzText: mrz, confidence: 63 }, 'passport-data')
      .accepted,
    true,
  );
});

test('accepts health-card front and EHIC back only on their matching sides', () => {
  const front = {
    confidence: 67,
    text: [
      'ELEKTRONISCHE GESUNDHEITSKARTE',
      'KRANKENVERSICHERUNG',
      'VERSICHERTENNUMMER A123456789',
      'GEBURTSDATUM 01.01.1990',
    ].join('\n'),
  };
  front.layout = cardLayout(front.text.split('\n'));
  const back = {
    confidence: 58,
    text: [
      'EUROPÄISCHE KRANKENVERSICHERUNGSKARTE',
      '3. Persönliche Kennnummer',
      '5. Kennnummer des Trägers',
      '6. Kennnummer der Karte',
      '9. Ablaufdatum',
    ].join('\n'),
  };

  assert.equal(classifyDocumentText(front, 'health-front').accepted, true);
  assert.equal(classifyDocumentText(front, 'health-back').accepted, false);
  assert.equal(classifyDocumentText(back, 'health-back').accepted, true);
  assert.equal(classifyDocumentText(back, 'health-front').accepted, false);
});

test('tax-ID photo requires both a valid German number and a tax-document label', () => {
  const taxId = validTaxId();
  const formatted = taxId.replace(
    /(\d{2})(\d{3})(\d{3})(\d{3})/u,
    '$1 $2 $3 $4',
  );
  const accepted = classifyDocumentText(
    {
      confidence: 71,
      text: `BUNDESZENTRALAMT FÜR STEUERN\nIhre Identifikationsnummer: ${formatted}`,
    },
    'tax-id',
  );
  assert.equal(accepted.accepted, true);
  assert.deepEqual(extractPlausibleGermanTaxIds(`ID: ${formatted}`), [taxId]);

  assert.equal(
    classifyDocumentText(
      { text: `Kundennummer ${formatted}`, confidence: 71 },
      'tax-id',
    ).accepted,
    false,
  );
  assert.equal(
    classifyDocumentText(
      {
        text: 'Steuerliche Identifikationsnummer 12 345 678 901',
        confidence: 71,
      },
      'tax-id',
    ).accepted,
    false,
  );
});

test('generic cards, badges, keyboards, books, screens and printed pages are unsupported', () => {
  const unsupported = [
    'Musterfirma GmbH\nErika Beispiel\nGeschäftsführung\nTelefon +49 40 123456',
    'MITARBEITERAUSWEIS\nSICHERHEIT NORD\nNAME MAX MUSTER\nPERSONALNUMMER 4172',
    'ESC F1 F2 F3 F4\nQ W E R T Z U I O P\nA S D F G H J K L\nLEERTASTE',
    'DEUTSCHE BANK\nGIROCARD\nIBAN DE12 3456 7890 1234 5678 90\nVALID THRU 12/30',
    'KAPITEL 4\nDIE GESCHICHTE DER STADT\nDieses Buch wurde im Jahr 2025 veröffentlicht.',
    'ANMELDUNG\nBENUTZERNAME\nPASSWORT\nJETZT EINLOGGEN',
    'Antrag auf Einstellung\nName Vorname Geburtstag Anschrift\nBitte vollständig ausfüllen.',
    'Zeitungsbericht\nPERSONALAUSWEIS\nBUNDESREPUBLIK DEUTSCHLAND\nNeue Regeln wurden veröffentlicht.',
    'IDENTITY CARD\nNAME MAX MUSTER\nDATE OF BIRTH 01.01.1990\nMITARBEITERAUSWEIS',
    'Informationsblatt\nELEKTRONISCHE GESUNDHEITSKARTE\nIhre KRANKENKASSE informiert.',
    'Informationsblatt\nELEKTRONISCHE GESUNDHEITSKARTE\nIhre VERSICHERTENNUMMER finden Sie hier.',
    'Bericht: BUNDESREPUBLIK DEUTSCHLAND PERSONALAUSWEIS. NAME und GEBURTSTAG sind wichtige Daten.',
    'Zeitungsbericht\nDer neue PERSONALAUSWEIS der BUNDESREPUBLIK DEUTSCHLAND\nenthält Angaben zu NAME, VORNAMEN, GEBURTSTAG und STAATSANGEHÖRIGKEIT.',
    'INFORMATIONSBLATT\nAlles über die ELEKTRONISCHE GESUNDHEITSKARTE\nIhre VERSICHERTENNUMMER und das GEBURTSDATUM werden von der KRANKENKASSE gespeichert.',
  ];
  for (const text of unsupported) {
    for (const slot of [
      'id-front',
      'id-back',
      'passport-data',
      'health-front',
      'health-back',
      'tax-id',
    ]) {
      const result = classifyDocumentText({ text, confidence: 80 }, slot);
      assert.equal(result.accepted, false, `${slot} accepted ${text}`);
      assert.equal(result.detectedSlot, null, `${slot} classified ${text}`);
    }
  }
});

test('requires positioned OCR rows instead of document words alone', () => {
  const idText = [
    'BUNDESREPUBLIK DEUTSCHLAND',
    'PERSONALAUSWEIS',
    'NAME MUSTERMANN',
    'GEBURTSTAG 01.01.1990',
  ].join('\n');
  assert.equal(
    classifyDocumentText({ text: idText, confidence: 80 }, 'id-front').accepted,
    false,
  );

  const healthText = [
    'ELEKTRONISCHE GESUNDHEITSKARTE',
    'KRANKENVERSICHERUNG',
    'VERSICHERTENNUMMER A123456789',
    'GEBURTSDATUM 01.01.1990',
  ].join('\n');
  assert.equal(
    classifyDocumentText({ text: healthText, confidence: 80 }, 'health-front')
      .accepted,
    false,
  );
});

test('parses only positioned OCR words into bounded line layout', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t10\t20\t60\t15\t92\tPERSONALAUSWEIS',
    '5\t1\t1\t1\t2\t1\t10\t80\t30\t15\t88\tNAME',
    '5\t1\t1\t1\t2\t2\t50\t80\t90\t15\t90\tMUSTERMANN',
    '5\t1\t1\t1\t3\t1\t10\t120\t30\t15\t-1\tIGNORED',
  ].join('\n');
  assert.deepEqual(parseOcrTsvLines(tsv, 200, 200), [
    {
      text: 'PERSONALAUSWEIS',
      x: 0.05,
      y: 0.1,
      width: 0.3,
      height: 0.075,
      confidence: 92,
    },
    {
      text: 'NAME MUSTERMANN',
      x: 0.05,
      y: 0.4,
      width: 0.65,
      height: 0.075,
      confidence: 89,
    },
  ]);
});

test('OCR errors, empty output and explicitly unusable confidence fail closed', () => {
  assert.equal(
    classifyDocumentText(null, 'id-front').reason,
    'recognition-failed',
  );
  assert.equal(
    classifyDocumentText({ error: new Error('worker failed') }, 'id-front')
      .reason,
    'recognition-failed',
  );
  assert.equal(
    classifyDocumentText({ text: '  ' }, 'id-front').reason,
    'ocr-empty',
  );
  assert.equal(
    classifyDocumentText(
      {
        text: 'BUNDESREPUBLIK DEUTSCHLAND PERSONALAUSWEIS NAME GEBURTSTAG',
        confidence: 2,
      },
      'id-front',
    ).reason,
    'ocr-low-confidence',
  );
  assert.equal(
    classifyDocumentText({ text: 'PERSONALAUSWEIS' }, 'something-else').reason,
    'unsupported-slot',
  );
});

function patternedImage(kind, brightness = 0) {
  const width = 32;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base =
        kind === 'left-right'
          ? x < width / 2
            ? 50
            : 180
          : (x + y) % 8 < 4
            ? 50
            : 180;
      const value = Math.max(0, Math.min(255, base + brightness));
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

test('visual signatures survive lighting shifts but detect a swapped surface', () => {
  const first = createVisualSignature(patternedImage('left-right'));
  const brighter = createVisualSignature(patternedImage('left-right', 35));
  const swapped = createVisualSignature(patternedImage('diagonal'));
  assert.ok(first);
  assert.equal(visualSignatureDistance(first, brighter), 0);
  assert.equal(documentVisualFingerprintsMatch(first, brighter), true);
  assert.ok(visualSignatureDistance(first, swapped) > 0.42);
  assert.equal(documentVisualFingerprintsMatch(first, swapped), false);
});
