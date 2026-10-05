export type ContactPermissionLevel = 'FULL_STATUS' | 'LIVE_LOCATION' | 'EMERGENCY_ONLY';

export interface TrustedContact {
  id: string;
  patientId: string;
  contactUserId?: string;
  contactName: string;
  contactPhone: string;
  relationship: string;
  permissionLevel: ContactPermissionLevel;
  createdAt: string;
}
