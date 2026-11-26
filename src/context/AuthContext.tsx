import React, { createContext, useCallback, useContext, useState } from 'react';
import { apiClient, extractApiError, setMemorySessionToken } from '../lib/api';
import type { AppRole, FactoryRecord, UserProfile } from '../types/prometheus';
import type { FactoryTwinProfile } from '../lib/counterfactual-engine';

interface AuthContextValue {
  profile: UserProfile | null;
  factories: FactoryRecord[];
  twinProfiles: Record<string, FactoryTwinProfile>;
  loading: boolean;
  authError: string | null;
  simpleLogin: (displayName: string, role: AppRole) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [twinProfiles, setTwinProfiles] = useState<Record<string, FactoryTwinProfile>>({});
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const simpleLogin = useCallback(async (displayName: string, role: AppRole) => {
    setLoading(true);
    setAuthError(null);
    try {
      const { data } = await apiClient.post<{
        token: string;
        user: UserProfile;
        factories: FactoryRecord[];
        twinProfiles: Record<string, FactoryTwinProfile>;
      }>('/auth/simple-login', { displayName, role });

      setMemorySessionToken(data.token);
      setProfile(data.user);
      setFactories(data.factories);
      setTwinProfiles(data.twinProfiles || {});
    } catch (err) {
      setMemorySessionToken(null);
      setProfile(null);
      setFactories([]);
      setAuthError(extractApiError(err, 'Unable to enter workspace. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{
        user: UserProfile;
        factories: FactoryRecord[];
        twinProfiles: Record<string, FactoryTwinProfile>;
      }>('/me');
      setProfile(data.user);
      setFactories(data.factories);
      setTwinProfiles(data.twinProfiles || {});
    } catch (err) {
      setAuthError(extractApiError(err, 'Session verification failed.'));
    }
  }, []);

  const logout = useCallback(async () => {
    setMemorySessionToken(null);
    setProfile(null);
    setFactories([]);
    setTwinProfiles({});
    setAuthError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        profile,
        factories,
        twinProfiles,
        loading,
        authError,
        simpleLogin,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
