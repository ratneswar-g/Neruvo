import { FareBreakdown, FareComponent } from '../types/journey.ts';

/**
 * Provider-neutral pricing policy configuration.
 * Accompaniment / waiting time is a first-class pricing dimension.
 */
export interface PricingPolicy {
  /** Unique version / identifier for policy traceability */
  version: string;

  /** Standard currency code (e.g. INR) */
  currency: string;

  /** Base service fee covering dispatch, vehicle allocation, initial preparation */
  baseServiceFee: number;

  /** Transport rate per kilometer (covers two-leg round-trip travel) */
  perDistanceRatePerKm: number;

  /** Companion hourly rate for on-site hospital accompaniment and waiting */
  perAccompanimentRatePerHour: number;

  /** Neravu platform, customer coordination and operations desk fee */
  platformFee: number;

  /** Goods & services tax rate (as decimal: e.g. 0.05 for 5%) */
  taxRate: number;

  /** Minimum journey fare threshold */
  minimumFare: number;

  /** Default anticipated hospital accompaniment duration in minutes for estimation */
  defaultEstimatedAccompanimentMinutes: number;
}

export interface FareCalculationInput {
  /** Outbound transit distance in meters (Home -> Hospital) */
  outboundDistanceMeters: number;

  /** Return transit distance in meters (Hospital -> Home) */
  returnDistanceMeters: number;

  /** Anticipated hospital accompaniment duration in minutes (defaults to policy default) */
  estimatedAccompanimentMinutes?: number;

  /** Custom policy snapshot to use, otherwise uses current active policy */
  policy?: PricingPolicy;
}

export interface PricingCalculationMetadata {
  outboundDistanceMeters: number;
  returnDistanceMeters: number;
  totalDistanceMeters: number;
  estimatedAccompanimentMinutes: number;
  policyVersion: string;
  isRoundTrip: boolean;
}
