import { Location } from './location.ts';
import { HospitalDestination } from './hospital.ts';

/**
 * Normal journey state sequence:
 * DRAFT
 * → REQUESTED
 * → MATCHING
 * → PARTNER_ASSIGNED
 * → PARTNER_EN_ROUTE
 * → PARTNER_ARRIVED
 * → PATIENT_PICKED_UP
 * → IN_TRANSIT_TO_HOSPITAL
 * → ARRIVED_AT_HOSPITAL
 * → HOSPITAL_VISIT (Care Partner stays with patient; journey remains ACTIVE)
 * → RETURN_STARTED
 * → IN_TRANSIT_TO_HOME
 * → PATIENT_RETURNED_HOME
 * → COMPLETED
 */
export type NormalJourneyState =
  | 'DRAFT'
  | 'REQUESTED'
  | 'MATCHING'
  | 'PARTNER_ASSIGNED'
  | 'PARTNER_EN_ROUTE'
  | 'PARTNER_ARRIVED'
  | 'PATIENT_PICKED_UP'
  | 'IN_TRANSIT_TO_HOSPITAL'
  | 'ARRIVED_AT_HOSPITAL'
  | 'HOSPITAL_VISIT'
  | 'RETURN_STARTED'
  | 'IN_TRANSIT_TO_HOME'
  | 'PATIENT_RETURNED_HOME'
  | 'COMPLETED';

export type ExceptionalJourneyState =
  | 'CANCELLED'
  | 'PARTNER_CANCELLED'
  | 'EMERGENCY_ACTIVE'
  | 'ESCALATED'
  | 'INCIDENT_REPORTED';

export type JourneyState = NormalJourneyState | ExceptionalJourneyState;

export type BookingType = 'ON_DEMAND' | 'SCHEDULED';

export interface FareComponent {
  code: string;
  name: string;
  amount: number;
  description?: string;
}

/**
 * Authoritative fare structure representation.
 * Accompaniment / waiting time is a first-class component.
 */
export interface FareBreakdown {
  currency: string;
  baseBookingFee: number;
  companionServiceTimeFee: number;
  transitDistanceFee: number;
  platformServiceFee: number;
  taxes: number;
  total: number;
  isEstimate: boolean;
  components?: FareComponent[];
}

export interface StateTransitionRecord {
  fromState: JourneyState;
  toState: JourneyState;
  timestamp: string;
  triggeredByUserId: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface EmergencyLogRecord {
  id: string;
  journeyId?: string;
  triggeredAt: string;
  triggeredByUserId: string;
  triggeredByRole?: string;
  stateAtTrigger: JourneyState;
  previousJourneyState?: JourneyState;
  locationSnapshot?: Location;
  destinationSnapshot?: HospitalDestination;
  category?: string;
  description?: string;
  status?: 'ACTIVE' | 'RESOLVED';
  resolvedAt?: string;
  resolvedByUserId?: string;
  resolutionNotes?: string;
}

export interface Journey {
  /** Single unique identifier for the complete round trip */
  id: string;
  patientId: string;
  carePartnerId: string | null;

  /** Leg 1 Origin */
  pickupLocation: Location;

  /** Medical Destination (Context/Destination only, not booking approver) */
  hospitalDestination: HospitalDestination;

  /** Leg 2 Destination: Return drop-off at patient's home */
  returnDropoffLocation: Location;

  /** Current journey lifecycle state */
  currentState: JourneyState;

  /** State before emergency activation to support recovery / operational handling */
  previousStateBeforeEmergency?: JourneyState;

  bookingType: BookingType;
  scheduledPickupTime?: string;
  isRoundTrip?: boolean;

  /** Full historical audit of transitions with timestamps */
  stateHistory: StateTransitionRecord[];

  /** Quick dictionary map of state -> timestamp for quick inspection */
  stateTimestamps: Partial<Record<JourneyState, string>>;

  /** Anticipated or final fare breakdown */
  fareEstimate?: FareBreakdown;
  initialFareEstimate?: FareBreakdown;
  finalFare?: FareBreakdown;

  /** Emergency and incident records */
  emergencyLogs: EmergencyLogRecord[];
  incidentReports: string[];

  specialAssistanceNotes?: string;

  createdAt: string;
  updatedAt: string;
}
