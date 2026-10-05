import { UserRole } from '../domain/types/user.ts';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string; // ISO string
  createdAt: string;
  isDevelopmentSession: boolean;
}

export type AuthStatus = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

/**
 * Standard AuthService contract.
 * Decouples business logic and UI from specific authentication mechanisms.
 */
export interface IAuthService {
  getCurrentSession(): Promise<AuthSession | null>;
  getCurrentUser(): Promise<AuthUser | null>;
  logout(): Promise<void>;
  restoreSession(): Promise<AuthSession | null>;
}

export interface DevLoginParams {
  role: UserRole;
  customUserId?: string;
}

export interface IDevAuthService extends IAuthService {
  loginAsDevRole(role: UserRole): Promise<AuthSession>;
  getAvailableDevIdentities(): AuthUser[];
}
