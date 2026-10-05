import { AuthSession, AuthUser, IDevAuthService } from './types.ts';
import { UserRole } from '../domain/types/user.ts';

export const DEV_IDENTITIES: Record<UserRole, AuthUser> = {
  PATIENT: {
    id: 'dev-user-patient-1',
    name: '[DEMO] Smt. Lakshmi Narayanan (Test Patient)',
    phone: '+91 98000 00001 (Dev Test)',
    role: 'PATIENT',
    status: 'ACTIVE',
  },
  CARE_PARTNER: {
    id: 'dev-user-partner-1',
    name: '[DEMO] Ramesh Kumar (Test Care Partner)',
    phone: '+91 98000 00002 (Dev Test)',
    role: 'CARE_PARTNER',
    status: 'ACTIVE',
  },
  FAMILY_CONTACT: {
    id: 'dev-user-family-1',
    name: '[DEMO] Anand Narayanan (Test Family Contact)',
    phone: '+91 98000 00003 (Dev Test)',
    role: 'FAMILY_CONTACT',
    status: 'ACTIVE',
  },
  ADMIN: {
    id: 'dev-user-admin-1',
    name: '[DEMO] Neravu Operations Desk (Test Admin)',
    phone: '+91 98000 00099 (Dev Test)',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
};

const STORAGE_KEY = 'neravu_dev_auth_session';

export class DevelopmentAuthProvider implements IDevAuthService {
  private inMemorySession: AuthSession | null = null;
  private readonly sessionDurationHours: number;

  constructor(sessionDurationHours = 12) {
    this.sessionDurationHours = sessionDurationHours;
  }

  getAvailableDevIdentities(): AuthUser[] {
    return Object.values(DEV_IDENTITIES);
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    if (this.inMemorySession) {
      if (this.isSessionExpired(this.inMemorySession)) {
        await this.logout();
        return null;
      }
      return this.inMemorySession;
    }

    // Attempt restoration from browser storage if in browser environment
    return this.restoreSession();
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = await this.getCurrentSession();
    return session ? session.user : null;
  }

  async loginAsDevRole(role: UserRole, customUser?: Partial<AuthUser>): Promise<AuthSession> {
    const baseUser = DEV_IDENTITIES[role];
    if (!baseUser) {
      throw new Error(`Invalid development role requested: ${role}`);
    }

    const user: AuthUser = {
      ...baseUser,
      ...customUser,
      role, // Role cannot be overridden arbitrarily
    };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionDurationHours * 3600 * 1000).toISOString();

    const session: AuthSession = {
      token: `dev-session-${user.id}-${Date.now()}`,
      user,
      createdAt: now.toISOString(),
      expiresAt,
      isDevelopmentSession: true,
    };

    this.inMemorySession = session;
    this.persistToStorage(session);

    return session;
  }

  async restoreSession(): Promise<AuthSession | null> {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return this.inMemorySession;
      }

      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return null;
      }

      const parsed: AuthSession = JSON.parse(stored);
      if (this.isSessionExpired(parsed)) {
        this.clearStorage();
        this.inMemorySession = null;
        return null;
      }

      this.inMemorySession = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    this.inMemorySession = null;
    this.clearStorage();
  }

  private isSessionExpired(session: AuthSession): boolean {
    const expiry = new Date(session.expiresAt).getTime();
    return Date.now() >= expiry;
  }

  private persistToStorage(session: AuthSession) {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch {
        // Ignore storage write issues
      }
    }
  }

  private clearStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage write issues
      }
    }
  }
}
