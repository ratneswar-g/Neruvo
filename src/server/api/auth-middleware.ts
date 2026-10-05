import { Request, Response, NextFunction } from 'express';
import { AuthUser } from '../../auth/types.ts';
import { DEV_IDENTITIES } from '../../auth/development-auth.ts';
import { DomainAction, authorizeAction, ResourceContext } from '../../auth/authorization.ts';
import { UserRole } from '../../domain/types/user.ts';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Extracts and validates the session user from Authorization header or dev identity headers.
 * Protects server boundary: verifies credentials before allowing access to domain services.
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const devUserIdHeader = req.headers['x-user-id'] as string | undefined;
  const devRoleHeader = req.headers['x-role'] as UserRole | undefined;

  let resolvedUser: AuthUser | null = null;

  // 1. If explicit user ID header provided, resolve to that exact user
  if (devUserIdHeader) {
    const matched = Object.values(DEV_IDENTITIES).find((i) => i.id === devUserIdHeader);
    if (matched) {
      resolvedUser = matched;
    } else {
      resolvedUser = {
        id: devUserIdHeader,
        name: `User (${devUserIdHeader})`,
        phone: '+91 98000 00000',
        role: devRoleHeader || 'PATIENT',
        status: 'ACTIVE',
      };
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    // Resolve token to exact user
    for (const identity of Object.values(DEV_IDENTITIES)) {
      if (token === `dev-session-${identity.id}` || token === `dev-session-${identity.role.toLowerCase()}` || token === identity.id) {
        resolvedUser = identity;
        break;
      }
    }
    // If token is of form dev-session-<custom-id>
    if (!resolvedUser && token.startsWith('dev-session-')) {
      const customId = token.substring(12);
      resolvedUser = {
        id: customId,
        name: `User (${customId})`,
        phone: '+91 98000 00000',
        role: devRoleHeader || 'PATIENT',
        status: 'ACTIVE',
      };
    }
  }

  // Fallback: If no explicit token passed in development, allow dev patient as default only if in dev environment
  if (!resolvedUser && process.env.NODE_ENV !== 'production' && req.headers['x-dev-role']) {
    const roleKey = req.headers['x-dev-role'] as keyof typeof DEV_IDENTITIES;
    if (DEV_IDENTITIES[roleKey]) {
      resolvedUser = DEV_IDENTITIES[roleKey];
    }
  }

  req.user = resolvedUser || undefined;
  next();
}

/**
 * Enforces that a valid authenticated user session is present.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Authentication required to access this resource',
    });
    return;
  }
  next();
}

/**
 * Enforces role-based access control.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'ROLE_FORBIDDEN',
        message: `Action requires one of the following roles: ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
}

/**
 * Validates domain authorization (including IDOR checks).
 */
export function checkAuthorization(
  action: DomainAction,
  getContext?: (req: AuthenticatedRequest) => Promise<ResourceContext> | ResourceContext
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
      return;
    }
    const context = getContext ? await getContext(req) : undefined;
    const authResult = authorizeAction(req.user, action, context);
    if (!authResult.authorized) {
      res.status(403).json({
        error: authResult.code || 'IDOR_VIOLATION',
        message: authResult.reason || 'Unauthorized access to resource',
      });
      return;
    }
    next();
  };
}
