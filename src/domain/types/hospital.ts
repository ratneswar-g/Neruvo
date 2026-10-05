/**
 * Hospital / Medical Destination model.
 * The hospital is strictly a geographical and context destination.
 * It is NOT an approver, confirmer, or controller of Neravu bookings.
 */
export interface HospitalDestination {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  entranceOrDepartment?: string;
  accessNotes?: string;
  emergencyContactPhone?: string;
}
