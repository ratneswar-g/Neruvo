import { JourneyState } from '../types/journey.ts';
import { UserRole } from '../types/user.ts';
import { Location } from '../types/location.ts';
import { HospitalDestination } from '../types/hospital.ts';

export type EmergencyCategory =
  | 'MEDICAL_EMERGENCY'
  | 'SAFETY_CONCERN'
  | 'ACCIDENT'
  | 'PATIENT_DISTRESS'
  | 'OTHER';

export const VALID_EMERGENCY_CATEGORIES: readonly EmergencyCategory[] = [
  'MEDICAL_EMERGENCY',
  'SAFETY_CONCERN',
  'ACCIDENT',
  'PATIENT_DISTRESS',
  'OTHER',
] as const;

export interface EmergencyIncidentRecord {
  id: string;
  journeyId: string;
  triggeredByUserId: string;
  triggeredByRole: UserRole;
  triggeredAt: string;
  previousJourneyState: JourneyState;
  locationSnapshot?: Location;
  hospitalSnapshot: HospitalDestination;
  returnDropoffSnapshot: Location;
  category: EmergencyCategory;
  description?: string;
  status: 'ACTIVE' | 'RESOLVED';
  resolvedAt?: string;
  resolvedByUserId?: string;
  /** Strictly operational resolution notes (e.g. incident reviewed by Admin, contact status confirmed, journey clearance; non-clinical only) */
  resolutionNotes?: string;
}

export interface TriggerEmergencyInput {
  journeyId: string;
  category?: EmergencyCategory;
  description?: string;
  currentLocationSnapshot?: Location;
}

export interface ResolveEmergencyInput {
  journeyId: string;
  incidentId?: string;
  resolutionNotes: string;
}
