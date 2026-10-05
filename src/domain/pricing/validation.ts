import { PricingPolicy, FareCalculationInput } from './types.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePricingPolicy(policy: PricingPolicy): ValidationResult {
  const errors: string[] = [];

  if (!policy.currency || typeof policy.currency !== 'string' || policy.currency.trim().length === 0) {
    errors.push('Currency is required and must be a valid non-empty string.');
  }

  if (typeof policy.baseServiceFee !== 'number' || isNaN(policy.baseServiceFee) || policy.baseServiceFee < 0) {
    errors.push('baseServiceFee must be a non-negative number.');
  }

  if (typeof policy.perDistanceRatePerKm !== 'number' || isNaN(policy.perDistanceRatePerKm) || policy.perDistanceRatePerKm < 0) {
    errors.push('perDistanceRatePerKm must be a non-negative number.');
  }

  if (typeof policy.perAccompanimentRatePerHour !== 'number' || isNaN(policy.perAccompanimentRatePerHour) || policy.perAccompanimentRatePerHour < 0) {
    errors.push('perAccompanimentRatePerHour must be a non-negative number.');
  }

  if (typeof policy.platformFee !== 'number' || isNaN(policy.platformFee) || policy.platformFee < 0) {
    errors.push('platformFee must be a non-negative number.');
  }

  if (typeof policy.minimumFare !== 'number' || isNaN(policy.minimumFare) || policy.minimumFare < 0) {
    errors.push('minimumFare must be a non-negative number.');
  }

  if (typeof policy.taxRate !== 'number' || isNaN(policy.taxRate) || policy.taxRate < 0 || policy.taxRate > 1) {
    errors.push('taxRate must be a decimal between 0.0 and 1.0 (e.g., 0.05 for 5%).');
  }

  if (
    typeof policy.defaultEstimatedAccompanimentMinutes !== 'number' ||
    isNaN(policy.defaultEstimatedAccompanimentMinutes) ||
    policy.defaultEstimatedAccompanimentMinutes < 0
  ) {
    errors.push('defaultEstimatedAccompanimentMinutes must be a non-negative number.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateFareInput(input: FareCalculationInput): ValidationResult {
  const errors: string[] = [];

  if (typeof input.outboundDistanceMeters !== 'number' || isNaN(input.outboundDistanceMeters) || input.outboundDistanceMeters < 0) {
    errors.push('outboundDistanceMeters must be a non-negative number.');
  }

  if (typeof input.returnDistanceMeters !== 'number' || isNaN(input.returnDistanceMeters) || input.returnDistanceMeters < 0) {
    errors.push('returnDistanceMeters must be a non-negative number.');
  }

  if (
    input.estimatedAccompanimentMinutes !== undefined &&
    (typeof input.estimatedAccompanimentMinutes !== 'number' ||
      isNaN(input.estimatedAccompanimentMinutes) ||
      input.estimatedAccompanimentMinutes < 0)
  ) {
    errors.push('estimatedAccompanimentMinutes must be a non-negative number if specified.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
