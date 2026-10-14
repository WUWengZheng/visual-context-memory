export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new DomainError(code, message, details);
}
