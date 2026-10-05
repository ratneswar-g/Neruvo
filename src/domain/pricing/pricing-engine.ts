import { PricingPolicy, FareCalculationInput } from './types.ts';
import { FareBreakdown, FareComponent } from '../types/journey.ts';
import { validatePricingPolicy, validateFareInput } from './validation.ts';
import { DomainError } from '../types/errors.ts';

/**
 * Standard production-default pricing policy for Neravu.
 * Currency is INR (₹).
 */
export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  version: 'policy-v1-standard',
  currency: 'INR',
  baseServiceFee: 250,
  perDistanceRatePerKm: 18,
  perAccompanimentRatePerHour: 200,
  platformFee: 100,
  taxRate: 0.05, // 5% GST
  minimumFare: 600,
  defaultEstimatedAccompanimentMinutes: 120, // 2 hours typical outpatient consultation
};

/**
 * Calculates deterministic journey fare estimate using domain policy.
 * Google Maps distance is an input to this calculation, never the pricing authority.
 */
export function calculateJourneyFare(
  input: FareCalculationInput,
  policy: PricingPolicy = DEFAULT_PRICING_POLICY
): FareBreakdown {
  const policyVal = validatePricingPolicy(policy);
  if (!policyVal.valid) {
    throw new DomainError('INVALID_PRICING_POLICY', `Invalid pricing policy: ${policyVal.errors.join(', ')}`);
  }

  const inputVal = validateFareInput(input);
  if (!inputVal.valid) {
    throw new DomainError('INVALID_PRICING_INPUT', `Invalid fare calculation inputs: ${inputVal.errors.join(', ')}`);
  }

  // 1. Round-Trip Transport Distance: Outbound (Home -> Hosp) + Return (Hosp -> Home)
  const totalDistanceMeters = input.outboundDistanceMeters + input.returnDistanceMeters;
  const totalDistanceKm = totalDistanceMeters / 1000;
  const transitDistanceFee = Math.round(totalDistanceKm * policy.perDistanceRatePerKm);

  // 2. Hospital Visit Accompaniment & Waiting Service Time
  const accompanimentMinutes =
    input.estimatedAccompanimentMinutes !== undefined
      ? input.estimatedAccompanimentMinutes
      : policy.defaultEstimatedAccompanimentMinutes;
  const accompanimentHours = accompanimentMinutes / 60;
  const companionServiceTimeFee = Math.round(accompanimentHours * policy.perAccompanimentRatePerHour);

  // 3. Base Service & Platform Coordination Fees
  const baseBookingFee = policy.baseServiceFee;
  const platformServiceFee = policy.platformFee;

  // 4. Subtotal & Minimum Fare Protection
  const rawSubtotal = baseBookingFee + transitDistanceFee + companionServiceTimeFee + platformServiceFee;
  let minFareAdjustment = 0;
  if (rawSubtotal < policy.minimumFare) {
    minFareAdjustment = policy.minimumFare - rawSubtotal;
  }
  const effectiveSubtotal = rawSubtotal + minFareAdjustment;

  // 5. Tax Calculation
  const taxes = Math.round(effectiveSubtotal * policy.taxRate);

  // 6. Authoritative Total
  const total = effectiveSubtotal + taxes;

  // Detailed breakdown components for transparent display
  const components: FareComponent[] = [
    {
      code: 'BASE_SERVICE',
      name: 'Base Service & Dispatch Fee',
      amount: baseBookingFee,
      description: 'Care Partner allocation, dispatch, and initial care coordination.',
    },
    {
      code: 'TRANSIT_DISTANCE',
      name: `Round-Trip Transportation (${totalDistanceKm.toFixed(1)} km)`,
      amount: transitDistanceFee,
      description: `Complete two-leg travel: Outbound (${(input.outboundDistanceMeters / 1000).toFixed(1)} km) + Return (${(input.returnDistanceMeters / 1000).toFixed(1)} km) @ ₹${policy.perDistanceRatePerKm}/km.`,
    },
    {
      code: 'COMPANION_SERVICE_TIME',
      name: `Hospital Visit Accompaniment (${accompanimentMinutes} mins estimate)`,
      amount: companionServiceTimeFee,
      description: `Care Partner stays on-site with patient during hospital consultation @ ₹${policy.perAccompanimentRatePerHour}/hr.`,
    },
    {
      code: 'PLATFORM_FEE',
      name: 'Neravu Safety & Platform Coordination',
      amount: platformServiceFee,
      description: 'Operations desk, trusted contact alerts, and continuous milestone monitoring.',
    },
  ];

  if (minFareAdjustment > 0) {
    components.push({
      code: 'MINIMUM_FARE_ADJUSTMENT',
      name: 'Minimum Service Threshold Adjustment',
      amount: minFareAdjustment,
      description: `Adjustment to meet minimum round-trip accompaniment threshold of ₹${policy.minimumFare}.`,
    });
  }

  components.push({
    code: 'TAXES',
    name: `Taxes & GST (${Math.round(policy.taxRate * 100)}%)`,
    amount: taxes,
    description: 'Applicable statutory services tax.',
  });

  // Verify total strictly equals sum of all components
  const componentSum = components.reduce((sum, c) => sum + c.amount, 0);
  if (componentSum !== total) {
    throw new DomainError('FARE_CALCULATION_MISMATCH', `Calculated fare total (${total}) does not equal component sum (${componentSum}).`);
  }

  return {
    currency: policy.currency,
    baseBookingFee,
    transitDistanceFee,
    companionServiceTimeFee,
    platformServiceFee,
    taxes,
    total,
    isEstimate: true,
    components,
  };
}
