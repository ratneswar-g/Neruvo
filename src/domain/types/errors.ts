export type DomainErrorCode =
  | 'INVALID_STATE_TRANSITION'
  | 'HOSPITAL_VISIT_CANNOT_COMPLETE'
  | 'ARRIVED_AT_HOSPITAL_CANNOT_COMPLETE'
  | 'COMPLETION_REQUIRES_RETURN_HOME'
  | 'PARTNER_NOT_ASSIGNED'
  | 'UNAUTHORIZED_TRANSITION'
  | 'UNAUTHORIZED_ACTION'
  | 'BOOKING_ALREADY_TERMINATED'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_DATA'
  | 'INVALID_PRICING_POLICY'
  | 'INVALID_PRICING_INPUT'
  | 'FARE_CALCULATION_MISMATCH'
  | 'PERSISTENCE_READ_ERROR'
  | 'PERSISTENCE_WRITE_ERROR'
  | 'RECORD_VALIDATION_ERROR'
  | 'DUPLICATE_ENTITY'
  | 'STORAGE_UNAVAILABLE';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly fromState?: string;
  public readonly toState?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    options?: {
      fromState?: string;
      toState?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.fromState = options?.fromState;
    this.toState = options?.toState;
    this.details = options?.details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}
