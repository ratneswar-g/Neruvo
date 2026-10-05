import {
  Journey,
  Location,
  HospitalDestination,
  BookingType,
  FareBreakdown,
} from './types/index.ts';

export interface CreateJourneyInput {
  id?: string;
  patientId: string;
  pickupLocation: Location;
  hospitalDestination: HospitalDestination;
  /** Defaults to pickupLocation if not specified (standard round trip back home) */
  returnDropoffLocation?: Location;
  bookingType?: BookingType;
  scheduledPickupTime?: string;
  specialAssistanceNotes?: string;
  initialFareEstimate?: FareBreakdown;
}

export function createRoundTripJourney(input: CreateJourneyInput): Journey {
  const now = new Date().toISOString();
  const id = input.id || `journey-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    patientId: input.patientId,
    carePartnerId: null,
    pickupLocation: input.pickupLocation,
    hospitalDestination: input.hospitalDestination,
    // The agreed return drop-off destination is the patient's home/agreed location
    returnDropoffLocation: input.returnDropoffLocation || input.pickupLocation,
    currentState: 'DRAFT',
    bookingType: input.bookingType || 'ON_DEMAND',
    scheduledPickupTime: input.scheduledPickupTime,
    isRoundTrip: true,
    stateHistory: [
      {
        fromState: 'DRAFT',
        toState: 'DRAFT',
        timestamp: now,
        triggeredByUserId: input.patientId,
        note: 'Journey created in DRAFT state.',
      },
    ],
    stateTimestamps: {
      DRAFT: now,
    },
    fareEstimate: input.initialFareEstimate,
    initialFareEstimate: input.initialFareEstimate,
    emergencyLogs: [],
    incidentReports: [],
    specialAssistanceNotes: input.specialAssistanceNotes,
    createdAt: now,
    updatedAt: now,
  };
}
