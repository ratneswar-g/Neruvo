import {
  Journey,
  JourneyState,
  StateTransitionRecord,
  DomainError,
} from '../types/index.ts';

export interface TransitionContext {
  triggeredByUserId: string;
  timestamp?: string;
  note?: string;
  assignedCarePartnerId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionValidationResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Standard legal transition graph for the complete round-trip journey.
 */
const LEGAL_TRANSITIONS: Record<JourneyState, JourneyState[]> = {
  DRAFT: ['REQUESTED', 'CANCELLED'],
  REQUESTED: ['MATCHING', 'CANCELLED'],
  MATCHING: ['PARTNER_ASSIGNED', 'CANCELLED'],
  PARTNER_ASSIGNED: [
    'PARTNER_EN_ROUTE',
    'CANCELLED',
    'PARTNER_CANCELLED',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  PARTNER_EN_ROUTE: [
    'PARTNER_ARRIVED',
    'CANCELLED',
    'PARTNER_CANCELLED',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  PARTNER_ARRIVED: [
    'PATIENT_PICKED_UP',
    'CANCELLED',
    'PARTNER_CANCELLED',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  PATIENT_PICKED_UP: [
    'IN_TRANSIT_TO_HOSPITAL',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  IN_TRANSIT_TO_HOSPITAL: [
    'ARRIVED_AT_HOSPITAL',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  ARRIVED_AT_HOSPITAL: [
    'HOSPITAL_VISIT',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  // HOSPITAL_VISIT: Care partner stays with patient. Does NOT complete.
  HOSPITAL_VISIT: [
    'RETURN_STARTED',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  RETURN_STARTED: [
    'IN_TRANSIT_TO_HOME',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  IN_TRANSIT_TO_HOME: [
    'PATIENT_RETURNED_HOME',
    'EMERGENCY_ACTIVE',
    'INCIDENT_REPORTED',
  ],
  // COMPLETED may only occur after PATIENT_RETURNED_HOME
  PATIENT_RETURNED_HOME: [
    'COMPLETED',
    'INCIDENT_REPORTED',
  ],
  COMPLETED: [], // Terminal normal state

  // Exceptional states
  CANCELLED: [], // Terminal
  PARTNER_CANCELLED: ['MATCHING'], // Re-dispatchable to matching
  EMERGENCY_ACTIVE: ['ESCALATED', 'INCIDENT_REPORTED'], // Or restored to prior state via admin
  ESCALATED: [],
  INCIDENT_REPORTED: [],
};

/**
 * Validates whether a state transition is permitted under domain rules.
 */
export function validateStateTransition(
  journey: Journey,
  targetState: JourneyState,
  context?: TransitionContext
): TransitionValidationResult {
  const current = journey.currentState;

  // Rule 4 & 14: HOSPITAL_VISIT cannot complete the booking
  if (current === 'HOSPITAL_VISIT' && targetState === 'COMPLETED') {
    return {
      allowed: false,
      errorCode: 'HOSPITAL_VISIT_CANNOT_COMPLETE',
      errorMessage:
        'HOSPITAL_VISIT does not complete the booking. The Care Partner remains with the patient during the visit/waiting period until the return journey starts.',
    };
  }

  // Rule 15: ARRIVED_AT_HOSPITAL cannot complete the booking
  if (current === 'ARRIVED_AT_HOSPITAL' && targetState === 'COMPLETED') {
    return {
      allowed: false,
      errorCode: 'ARRIVED_AT_HOSPITAL_CANNOT_COMPLETE',
      errorMessage:
        'Arrival at hospital does not complete the booking. The hospital is not the final destination of the Neravu journey.',
    };
  }

  // Rule 3: COMPLETED may ONLY occur after PATIENT_RETURNED_HOME
  if (targetState === 'COMPLETED' && current !== 'PATIENT_RETURNED_HOME') {
    return {
      allowed: false,
      errorCode: 'COMPLETION_REQUIRES_RETURN_HOME',
      errorMessage:
        'Journey can only be marked COMPLETED after the patient has safely returned home (PATIENT_RETURNED_HOME).',
    };
  }

  // Terminal state check
  if (current === 'COMPLETED' || current === 'CANCELLED') {
    return {
      allowed: false,
      errorCode: 'BOOKING_ALREADY_TERMINATED',
      errorMessage: `Cannot transition from terminated state ${current}.`,
    };
  }

  // Partner assignment check
  if (targetState === 'PARTNER_ASSIGNED') {
    const partnerId = context?.assignedCarePartnerId || journey.carePartnerId;
    if (!partnerId) {
      return {
        allowed: false,
        errorCode: 'PARTNER_NOT_ASSIGNED',
        errorMessage: 'A Care Partner ID must be assigned to enter PARTNER_ASSIGNED state.',
      };
    }
  }

  // Check legal transitions lookup
  const allowedNextStates = LEGAL_TRANSITIONS[current] || [];
  if (!allowedNextStates.includes(targetState)) {
    return {
      allowed: false,
      errorCode: 'INVALID_STATE_TRANSITION',
      errorMessage: `Invalid state transition from ${current} to ${targetState}.`,
    };
  }

  return { allowed: true };
}

/**
 * Executes a verified state transition on a journey.
 * Throws a DomainError if the transition is prohibited.
 */
export function transitionJourney(
  journey: Journey,
  targetState: JourneyState,
  context: TransitionContext
): Journey {
  const validation = validateStateTransition(journey, targetState, context);

  if (!validation.allowed) {
    throw new DomainError(
      (validation.errorCode as any) || 'INVALID_STATE_TRANSITION',
      validation.errorMessage || `Cannot transition from ${journey.currentState} to ${targetState}`,
      {
        fromState: journey.currentState,
        toState: targetState,
        details: { journeyId: journey.id, context },
      }
    );
  }

  const transitionTimestamp = context.timestamp || new Date().toISOString();

  const transitionRecord: StateTransitionRecord = {
    fromState: journey.currentState,
    toState: targetState,
    timestamp: transitionTimestamp,
    triggeredByUserId: context.triggeredByUserId,
    note: context.note,
    metadata: context.metadata,
  };

  // Build updated journey with immutability
  const updatedJourney: Journey = {
    ...journey,
    currentState: targetState,
    carePartnerId:
      targetState === 'PARTNER_ASSIGNED' && context.assignedCarePartnerId
        ? context.assignedCarePartnerId
        : journey.carePartnerId,
    previousStateBeforeEmergency:
      targetState === 'EMERGENCY_ACTIVE'
        ? journey.currentState
        : journey.previousStateBeforeEmergency,
    stateHistory: [...journey.stateHistory, transitionRecord],
    stateTimestamps: {
      ...journey.stateTimestamps,
      [targetState]: transitionTimestamp,
    },
    updatedAt: transitionTimestamp,
  };

  return updatedJourney;
}

/**
 * Restores a journey from EMERGENCY_ACTIVE back to its pre-emergency state.
 * Requires operational/admin clearance.
 */
export function restoreFromEmergency(
  journey: Journey,
  context: TransitionContext
): Journey {
  if (journey.currentState !== 'EMERGENCY_ACTIVE') {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      'Cannot restore from emergency: journey is not in EMERGENCY_ACTIVE state.',
      { fromState: journey.currentState }
    );
  }

  const resumeState = journey.previousStateBeforeEmergency;
  if (!resumeState) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      'Cannot restore from emergency: no previous state was recorded.',
      { fromState: journey.currentState }
    );
  }

  const transitionTimestamp = context.timestamp || new Date().toISOString();

  const transitionRecord: StateTransitionRecord = {
    fromState: 'EMERGENCY_ACTIVE',
    toState: resumeState,
    timestamp: transitionTimestamp,
    triggeredByUserId: context.triggeredByUserId,
    note: context.note || 'Emergency cleared; resumed previous active state.',
    metadata: context.metadata,
  };

  return {
    ...journey,
    currentState: resumeState,
    previousStateBeforeEmergency: undefined,
    stateHistory: [...journey.stateHistory, transitionRecord],
    stateTimestamps: {
      ...journey.stateTimestamps,
      [resumeState]: transitionTimestamp,
    },
    updatedAt: transitionTimestamp,
  };
}
