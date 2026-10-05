import { AuthUser } from './types.ts';
import { UserRole } from '../domain/types/user.ts';

export interface RouteGuardResult {
  allowed: boolean;
  redirectTo?: string;
  reason?: string;
}

export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case 'PATIENT':
      return '/patient/home';
    case 'CARE_PARTNER':
      return '/care-partner/dashboard';
    case 'FAMILY_CONTACT':
      return '/family/tracking';
    case 'ADMIN':
      return '/admin/overview';
    default:
      return '/login';
  }
}

/**
 * Validates route access based on active authenticated session and required role.
 */
export function canAccessRoute(user: AuthUser | null, path: string): RouteGuardResult {
  // Public routes
  if (path === '/login' || path === '/') {
    return { allowed: true };
  }

  // Protected route requires authentication
  if (!user) {
    return {
      allowed: false,
      redirectTo: '/login',
      reason: 'Authentication required to access protected routes.',
    };
  }

  // Patient paths
  if (path.startsWith('/patient')) {
    if (user.role === 'PATIENT' || user.role === 'ADMIN') {
      return { allowed: true };
    }
    return {
      allowed: false,
      redirectTo: getDefaultRouteForRole(user.role),
      reason: `Access denied. Role ${user.role} is not permitted to access patient portal.`,
    };
  }

  // Care Partner paths
  if (path.startsWith('/care-partner')) {
    if (user.role === 'CARE_PARTNER' || user.role === 'ADMIN') {
      return { allowed: true };
    }
    return {
      allowed: false,
      redirectTo: getDefaultRouteForRole(user.role),
      reason: `Access denied. Role ${user.role} is not permitted to access Care Partner portal.`,
    };
  }

  // Family Contact paths
  if (path.startsWith('/family')) {
    if (user.role === 'FAMILY_CONTACT' || user.role === 'ADMIN') {
      return { allowed: true };
    }
    return {
      allowed: false,
      redirectTo: getDefaultRouteForRole(user.role),
      reason: `Access denied. Role ${user.role} is not permitted to access family tracking.`,
    };
  }

  // Admin paths
  if (path.startsWith('/admin')) {
    if (user.role === 'ADMIN') {
      return { allowed: true };
    }
    return {
      allowed: false,
      redirectTo: getDefaultRouteForRole(user.role),
      reason: `Access denied. Admin portal requires ADMIN role. Current role: ${user.role}`,
    };
  }

  return { allowed: true };
}
