import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { AuthSession, AuthUser, IDevAuthService } from './types.ts';
import { DevelopmentAuthProvider, DEV_IDENTITIES } from './development-auth.ts';
import { UserRole } from '../domain/types/user.ts';

export interface AuthContextValue {
  currentUser: AuthUser | null;
  currentSession: AuthSession | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  availableDevIdentities: AuthUser[];
  loginAsDevRole: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Default singleton auth service for app lifecycle
export const defaultDevAuthService: IDevAuthService = new DevelopmentAuthProvider();

interface AuthProviderProps {
  children: React.ReactNode;
  authService?: IDevAuthService;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  authService = defaultDevAuthService,
}) => {
  const [currentSession, setCurrentSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize session on mount
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const session = await authService.getCurrentSession();
        if (mounted) {
          setCurrentSession(session);
        }
      } catch (err) {
        console.error('Failed to initialize session:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();
    return () => {
      mounted = false;
    };
  }, [authService]);

  const loginAsDevRole = async (role: UserRole) => {
    setIsLoading(true);
    try {
      const session = await authService.loginAsDevRole(role);
      setCurrentSession(session);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authService.logout();
      setCurrentSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  const currentUser = currentSession?.user || null;
  const role = currentUser?.role || null;
  const isAuthenticated = !!currentUser;
  const availableDevIdentities = useMemo(() => authService.getAvailableDevIdentities(), [authService]);

  const value: AuthContextValue = {
    currentUser,
    currentSession,
    role,
    isAuthenticated,
    isLoading,
    availableDevIdentities,
    loginAsDevRole,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
