import { EmergencyCategory, VALID_EMERGENCY_CATEGORIES } from './types.ts';
import { Journey } from '../types/journey.ts';

export function isValidEmergencyCategory(category: string): category is EmergencyCategory {
  return VALID_EMERGENCY_CATEGORIES.includes(category as EmergencyCategory);
}

export function validateEmergencyTrigger(
  journey: Journey,
  category?: string
): { valid: boolean; error?: string } {
  if (journey.currentState === 'COMPLETED' || journey.currentState === 'CANCELLED') {
    return {
      valid: false,
      error: `Cannot trigger emergency on terminated journey in ${journey.currentState} state.`,
    };
  }

  if (category && !isValidEmergencyCategory(category)) {
    return {
      valid: false,
      error: `Invalid emergency category '${category}'. Allowed categories: ${VALID_EMERGENCY_CATEGORIES.join(', ')}.`,
    };
  }

  return { valid: true };
}
