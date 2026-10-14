const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

export function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

export function optionalString(value, label) {
  if (value === undefined || value === null) return null;
  return requireString(value, label, { allowEmpty: true });
}

export function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID`);
  }
  return value;
}

export function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

export function requireNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function optionalIsoTimestamp(value, label) {
  if (value === undefined || value === null) return null;
  requireString(value, label);
  if (new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a UTC ISO 8601 timestamp with milliseconds`);
  }
  return value;
}

export function jsonText(value, label, { nullable = true } = {}) {
  if ((value === undefined || value === null) && nullable) return null;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    JSON.parse(text);
    return text;
  } catch {
    throw new TypeError(`${label} must be valid JSON`);
  }
}
