import { Location } from './location.ts';
import { TrustedContact } from './trusted-contact.ts';

export type MobilityAssistanceNeed =
  | 'INDEPENDENT_WALKER'
  | 'CANE_OR_CRUTCHES'
  | 'WALKER'
  | 'WHEELCHAIR_TRANSFER'
  | 'WHEELCHAIR_ACCESSIBLE_VEHICLE'
  | 'STAIR_ASSISTANCE'
  | 'VISION_OR_HEARING_ACCOMMODATION';

export interface PatientProfile {
  userId: string;
  homeAddress: Location;
  mobilityAssistance: MobilityAssistanceNeed[];
  /** Non-clinical assistance notes (e.g. "needs companion to carry documents and wait at registration") */
  nonClinicalAssistanceNotes: string;
  trustedContacts: TrustedContact[];
  createdAt: string;
  updatedAt: string;
}
