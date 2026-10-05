import { AuthUser } from './types.ts';
import { UserRole } from '../domain/types/user.ts';
import { Journey, JourneyState } from '../domain/types/journey.ts';
import { TrustedContact, ContactPermissionLevel } from '../domain/types/trusted-contact.ts';

export type DomainAction =
  | 'VIEW_JOURNEY'
  | 'VIEW_JOURNEY_LOCATION'
  | 'VIEW_JOURNEY_DETAILS'
  | 'VIEW_JOURNEY_EMERGENCY'
  | 'CREATE_JOURNEY'
  | 'CANCEL_JOURNEY'
  | 'UPDATE_JOURNEY_MILESTONE'
  | 'VIEW_PATIENT_PROFILE'
  | 'UPDATE_PATIENT_PROFILE'
  | 'UPDATE_PARTNER_AVAILABILITY'
  | 'VIEW_PARTNER_PROFILE'
  | 'ACCESS_ADMIN_OPERATIONS'
  | 'MANAGE_USERS'
  | 'MANAGE_CARE_PARTNERS'
  | 'DISPATCH_JOURNEY'
  | 'RESOLVE_EMERGENCY'
  | 'VIEW_PRICING'
  | 'UPDATE_PRICING_POLICY';

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  code?: 'UNAUTHENTICATED' | 'FORBIDDEN_ROLE' | 'IDOR_VIOLATION' | 'READ_ONLY_ACCESS';
  permissionLevel?: ContactPermissionLevel;
}

export interface FamilyAccessScope {
  isAuthorized: boolean;
  permissionLevel?: ContactPermissionLevel;
  canViewStatusMilestones: boolean;
  canViewLocationFromBooking: boolean;
  canViewCompanionDetails: boolean;
  canViewEmergencyAlerts: boolean;
  reason?: string;
}

/**
 * Resolves the precise access scope for a Family / Trusted Contact based on their permission level.
 */
export function getFamilyAccessScope(
  user: AuthUser,
  journey: Journey,
  trustedContacts: TrustedContact[]
): FamilyAccessScope {
  if (user.role !== 'FAMILY_CONTACT') {
    return {
      isAuthorized: false,
      canViewStatusMilestones: false,
      canViewLocationFromBooking: false,
      canViewCompanionDetails: false,
      canViewEmergencyAlerts: false,
      reason: 'User is not a Family Contact.',
    };
  }

  const match = trustedContacts.find(
    (c) =>
      c.patientId === journey.patientId &&
      (c.contactUserId === user.id || c.contactPhone === user.phone)
  );

  if (!match) {
    return {
      isAuthorized: false,
      canViewStatusMilestones: false,
      canViewLocationFromBooking: false,
      canViewCompanionDetails: false,
      canViewEmergencyAlerts: false,
      reason: 'Family Contact is not authorized by the patient for this journey.',
    };
  }

  const perm = match.permissionLevel;

  if (perm === 'FULL_STATUS') {
    return {
      isAuthorized: true,
      permissionLevel: 'FULL_STATUS',
      canViewStatusMilestones: true,
      canViewLocationFromBooking: true,
      canViewCompanionDetails: true,
      canViewEmergencyAlerts: true,
    };
  }

  if (perm === 'LIVE_LOCATION') {
    return {
      isAuthorized: true,
      permissionLevel: 'LIVE_LOCATION',
      canViewStatusMilestones: false,
      canViewLocationFromBooking: true,
      canViewCompanionDetails: false,
      canViewEmergencyAlerts: true,
    };
  }

  if (perm === 'EMERGENCY_ONLY') {
    return {
      isAuthorized: true,
      permissionLevel: 'EMERGENCY_ONLY',
      canViewStatusMilestones: false,
      canViewLocationFromBooking: journey.currentState === 'EMERGENCY_ACTIVE',
      canViewCompanionDetails: false,
      canViewEmergencyAlerts: true,
    };
  }

  return {
    isAuthorized: false,
    canViewStatusMilestones: false,
    canViewLocationFromBooking: false,
    canViewCompanionDetails: false,
    canViewEmergencyAlerts: false,
    reason: 'Unknown permission level.',
  };
}

export interface ResourceContext {
  journey?: Journey;
  patientId?: string;
  carePartnerId?: string;
  trustedContacts?: TrustedContact[];
}

/**
 * Evaluates whether an authenticated user is authorized to perform a specific action.
 */
export function authorizeAction(
  user: AuthUser | null,
  action: DomainAction,
  resourceContext?: ResourceContext
): AuthorizationResult {
  if (!user) {
    return {
      authorized: false,
      code: 'UNAUTHENTICATED',
      reason: 'Authentication required. No active authenticated session.',
    };
  }

  // 1. ADMIN PRIVILEGES
  if (user.role === 'ADMIN') {
    return { authorized: true };
  }

  // Prevent non-admins from accessing privileged administrative functions
  if (
    action === 'ACCESS_ADMIN_OPERATIONS' ||
    action === 'MANAGE_USERS' ||
    action === 'MANAGE_CARE_PARTNERS' ||
    action === 'DISPATCH_JOURNEY' ||
    action === 'UPDATE_PRICING_POLICY'
  ) {
    return {
      authorized: false,
      code: 'FORBIDDEN_ROLE',
      reason: `Action '${action}' is restricted to users with ADMIN role. Current role: ${user.role}`,
    };
  }

  // 2. PATIENT ACTIONS
  if (user.role === 'PATIENT') {
    if (
      action === 'CREATE_JOURNEY' ||
      action === 'VIEW_JOURNEY' ||
      action === 'VIEW_JOURNEY_LOCATION' ||
      action === 'VIEW_JOURNEY_DETAILS' ||
      action === 'VIEW_JOURNEY_EMERGENCY' ||
      action === 'VIEW_PRICING'
    ) {
      if (!resourceContext?.journey) return { authorized: true };
      if (resourceContext.journey.patientId !== user.id) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: 'Patient can only access their own journeys. Access to another patient journey is rejected.',
        };
      }
      return { authorized: true };
    }

    if (action === 'VIEW_PATIENT_PROFILE' || action === 'UPDATE_PATIENT_PROFILE') {
      if (resourceContext?.patientId && resourceContext.patientId !== user.id) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: 'Patients are strictly prohibited from viewing or modifying other patients profiles.',
        };
      }
      return { authorized: true };
    }

    if (action === 'CANCEL_JOURNEY') {
      if (!resourceContext?.journey) return { authorized: true };
      if (resourceContext.journey.patientId !== user.id) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: 'Patient can only cancel their own journey.',
        };
      }
      return { authorized: true };
    }

    return {
      authorized: false,
      code: 'FORBIDDEN_ROLE',
      reason: 'Action not permitted for PATIENT role.',
    };
  }

  // 3. CARE PARTNER ACTIONS
  if (user.role === 'CARE_PARTNER') {
    if (action === 'UPDATE_PARTNER_AVAILABILITY') {
      if (resourceContext?.carePartnerId && resourceContext.carePartnerId !== user.id) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: 'Care Partners cannot alter another partner availability.',
        };
      }
      return { authorized: true };
    }

    if (
      action === 'VIEW_JOURNEY' ||
      action === 'VIEW_JOURNEY_LOCATION' ||
      action === 'VIEW_JOURNEY_DETAILS' ||
      action === 'VIEW_JOURNEY_EMERGENCY' ||
      action === 'UPDATE_JOURNEY_MILESTONE' ||
      action === 'VIEW_PRICING'
    ) {
      if (!resourceContext?.journey) {
        return { authorized: true };
      }

      const journey = resourceContext.journey;
      const isAssigned = journey.carePartnerId === user.id;
      const isOffered = journey.currentState === 'MATCHING';

      if (!isAssigned && !isOffered) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: 'Care Partner can only view journeys offered to them or assigned to them.',
        };
      }
      return { authorized: true };
    }

    return {
      authorized: false,
      code: 'FORBIDDEN_ROLE',
      reason: 'Action not permitted for CARE_PARTNER role.',
    };
  }

  // 4. FAMILY / TRUSTED CONTACT ACTIONS
  if (user.role === 'FAMILY_CONTACT') {
    // Family contacts are strictly read-only
    if (
      action === 'UPDATE_JOURNEY_MILESTONE' ||
      action === 'CANCEL_JOURNEY' ||
      action === 'CREATE_JOURNEY'
    ) {
      return {
        authorized: false,
        code: 'READ_ONLY_ACCESS',
        reason: 'Family contacts hold read-only permissions and cannot modify journey milestones or booking state.',
      };
    }

    if (
      action === 'VIEW_JOURNEY' ||
      action === 'VIEW_JOURNEY_LOCATION' ||
      action === 'VIEW_JOURNEY_DETAILS' ||
      action === 'VIEW_JOURNEY_EMERGENCY' ||
      action === 'VIEW_PRICING'
    ) {
      if (!resourceContext?.journey) {
        return { authorized: false, code: 'IDOR_VIOLATION', reason: 'Journey context required.' };
      }

      const trustedContacts = resourceContext.trustedContacts || [];
      const scope = getFamilyAccessScope(user, resourceContext.journey, trustedContacts);

      if (!scope.isAuthorized) {
        return {
          authorized: false,
          code: 'IDOR_VIOLATION',
          reason: scope.reason || 'Family Contact is not authorized by the patient for this journey.',
        };
      }

      if (action === 'VIEW_PRICING' && scope.permissionLevel !== 'FULL_STATUS') {
        return {
          authorized: false,
          code: 'FORBIDDEN_ROLE',
          permissionLevel: scope.permissionLevel,
          reason: `Permission tier '${scope.permissionLevel}' does not permit access to fare details. Requires FULL_STATUS.`,
        };
      }

      if (action === 'VIEW_JOURNEY_DETAILS' && !scope.canViewStatusMilestones) {
        return {
          authorized: false,
          code: 'FORBIDDEN_ROLE',
          permissionLevel: scope.permissionLevel,
          reason: `Permission tier '${scope.permissionLevel}' does not permit access to non-location journey details.`,
        };
      }

      if (action === 'VIEW_JOURNEY_LOCATION' && !scope.canViewLocationFromBooking) {
        return {
          authorized: false,
          code: 'FORBIDDEN_ROLE',
          permissionLevel: scope.permissionLevel,
          reason: `Permission tier '${scope.permissionLevel}' restricts location viewing when emergency is inactive.`,
        };
      }

      return {
        authorized: true,
        permissionLevel: scope.permissionLevel,
      };
    }

    return {
      authorized: false,
      code: 'FORBIDDEN_ROLE',
      reason: 'Action not permitted for FAMILY_CONTACT role.',
    };
  }

  return { authorized: false, code: 'FORBIDDEN_ROLE', reason: 'Unknown role.' };
}

