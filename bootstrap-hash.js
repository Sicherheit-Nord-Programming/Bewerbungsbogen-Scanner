(() => {
  if (window.__SN_SCANNER_REDIRECTING__) return;

  const STORAGE_KEY = 'sn-id-scanner.resume.v1';
  const SCHEMA_VERSION = 1;
  const MAX_RESUME_TTL_MS = 20 * 60 * 1_000;
  const STATION_PATTERN = /^[a-f0-9]{64}$/;
  const SESSION_PATTERN =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const COMPACT_BOOTSTRAP_PATTERN = /^#[A-Za-z0-9_-]{22}$/;
  const CAPSULE_FIELDS = [
    'bootstrapHash',
    'expiresAt',
    'phoneSession',
    'schemaVersion',
    'sessionId',
    'stationId',
  ];

  function storage() {
    try {
      return window.localStorage ?? null;
    } catch {
      return null;
    }
  }

  function clear() {
    try {
      storage()?.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in a private or restricted browser context.
    }
  }

  function staticBootstrapMatchesStation(bootstrapHash, stationId) {
    if (
      typeof bootstrapHash !== 'string' ||
      bootstrapHash.length > 2_048 ||
      Array.from(bootstrapHash).some(
        (character) => character.codePointAt(0) <= 0x20,
      )
    ) {
      return false;
    }
    if (COMPACT_BOOTSTRAP_PATTERN.test(bootstrapHash)) return true;
    if (!bootstrapHash.startsWith('#')) return false;
    try {
      const parameters = new URLSearchParams(bootstrapHash.slice(1));
      const fields = [...parameters.keys()].sort();
      return (
        fields.length === 4 &&
        fields.every((field, index) => field === ['d', 'e', 'p', 'v'][index]) &&
        parameters.get('v') === '3' &&
        parameters.get('d') === stationId &&
        CAPABILITY_PATTERN.test(parameters.get('p') || '') &&
        Boolean(parameters.get('e'))
      );
    } catch {
      return false;
    }
  }

  function normalize(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const fields = Object.keys(value).sort();
    if (
      fields.length !== CAPSULE_FIELDS.length ||
      fields.some((field, index) => field !== CAPSULE_FIELDS[index]) ||
      value.schemaVersion !== SCHEMA_VERSION ||
      !STATION_PATTERN.test(value.stationId) ||
      !SESSION_PATTERN.test(value.sessionId) ||
      !CAPABILITY_PATTERN.test(value.phoneSession) ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now ||
      !staticBootstrapMatchesStation(value.bootstrapHash, value.stationId)
    ) {
      return null;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      stationId: value.stationId,
      sessionId: value.sessionId,
      phoneSession: value.phoneSession,
      bootstrapHash: value.bootstrapHash,
      expiresAt: Math.min(value.expiresAt, now + MAX_RESUME_TTL_MS),
    };
  }

  function load() {
    let serialized = '';
    try {
      serialized = storage()?.getItem(STORAGE_KEY) || '';
    } catch {
      return null;
    }
    if (!serialized) return null;
    try {
      const capsule = normalize(JSON.parse(serialized));
      if (!capsule) clear();
      return capsule;
    } catch {
      clear();
      return null;
    }
  }

  function save(value) {
    const capsule = normalize({ ...value, schemaVersion: SCHEMA_VERSION });
    if (!capsule) {
      clear();
      return false;
    }
    try {
      const target = storage();
      if (!target) return false;
      target.setItem(STORAGE_KEY, JSON.stringify(capsule));
      return true;
    } catch {
      return false;
    }
  }

  Object.defineProperty(window, '__SN_SCANNER_RESUME__', {
    value: Object.freeze({ clear, load, save }),
    writable: false,
    configurable: false,
  });

  const liveHash = String(window.location.hash || '');
  const resume = liveHash ? null : load();
  const bootstrapHash = liveHash || resume?.bootstrapHash || '';
  if (bootstrapHash) {
    Object.defineProperty(window, '__SN_SCANNER_BOOTSTRAP_HASH__', {
      value: bootstrapHash,
      writable: true,
      configurable: true,
    });
  }
  if (liveHash) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
})();
