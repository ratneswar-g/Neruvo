export type PartnerVerificationStatus =
  | 'PENDING_DOCUMENTATION'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUSPENDED';

export type PartnerAvailabilityStatus = 'OFFLINE' | 'AVAILABLE' | 'ON_JOURNEY';

export interface VehicleInfo {
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
  seatingCapacity: number;
  accommodationsDescription?: string;
}

export interface CarePartnerProfile {
  userId: string;
  verificationStatus: PartnerVerificationStatus;
  availabilityStatus: PartnerAvailabilityStatus;
  vehicle: VehicleInfo;
  ratingAverage?: number;
  totalJourneysCompleted: number;
  firstAidCertified?: boolean;
  backgroundCheckVerifiedDate?: string;
  createdAt: string;
  updatedAt: string;
}
