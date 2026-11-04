import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { apiRequest } from './api';
import { signInWithGoogleFirebase, FirebaseConfig } from './firebase';

export interface AuthConfig {
  emailPasswordEnabled: boolean;
  googleEnabled: boolean;
  discordEnabled: boolean;
  registrationEnabled: boolean;
  firebaseConfig?: FirebaseConfig;
  discordClientId?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authConfig: AuthConfig;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (username: string, displayName: string, email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  loginWithDiscord: () => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updatedUser: Partial<User>) => void;
  refreshAuthConfig: () => Promise<void>;
}

const defaultAuthConfig: AuthConfig = {
  emailPasswordEnabled: true,
  googleEnabled: true,
  discordEnabled: true,
  registrationEnabled: true
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authConfig, setAuthConfig] = useState<AuthConfig>(defaultAuthConfig);

  const fetchAuthConfig = useCallback(async () => {
    try {
      const res = await apiRequest('/auth/config');
      if (res.success && res.data) {
        setAuthConfig(res.data);
      }
    } catch (err) {
      console.error('[AuthContext] Failed to load auth provider configuration:', err);
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    try {
      // Always ask the server: the session may live only in the httpOnly cookie (e.g. after a Discord sign-in popup).
      const res = await apiRequest('/auth/me');
      if (res.success && res.data?.user) {
        setUser(res.data.user);
      } else if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'INVALID_TOKEN') {
        // Only a definite "not signed in" answer ends the session. A dropped connection, a 429 or a 500 on a phone used to
        // wipe the token here and log the person out; now they simply stay as they were.
        try { localStorage.removeItem('aether_token'); } catch { /* ignore */ }
        setUser(null);
      }
    } catch {
      /* network failure: keep the current session state */
    } finally {
      setLoading(false);
    }
  }, []);

  // apiRequest reports a rejected session here (see api.ts).
  useEffect(() => {
    const onExpired = () => { try { localStorage.removeItem('aether_token'); } catch { /* ignore */ } setUser(null); };
    window.addEventListener('mono:session-expired', onExpired);
    return () => window.removeEventListener('mono:session-expired', onExpired);
  }, []);

  useEffect(() => {
    fetchAuthConfig();
    fetchCurrentUser();
  }, [fetchAuthConfig, fetchCurrentUser]);

  const login = async (email: string, password: string) => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (res.success && res.data?.token) {
      localStorage.setItem('aether_token', res.data.token);
      setUser(res.data.user);
      return { success: true };
    }

    return {
      success: false,
      message: res.error?.message || 'Login failed.'
    };
  };

  const register = async (username: string, displayName: string, email: string, password: string) => {
    const res = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, displayName, email, password })
    });

    if (res.success && res.data?.token) {
      localStorage.setItem('aether_token', res.data.token);
      setUser(res.data.user);
      return { success: true };
    }

    return {
      success: false,
      message: res.error?.message || 'Registration failed.'
    };
  };

  // Google Sign-In using Firebase SDK
  const loginWithGoogle = async (): Promise<{ success: boolean; message?: string }> => {
    try {
      const googleProfile = await signInWithGoogleFirebase(authConfig.firebaseConfig);

      // The server verifies the signed Firebase ID token itself; profile fields are taken from the token, never from us.
      const res = await apiRequest('/auth/firebase-verify', {
        method: 'POST',
        body: JSON.stringify({ idToken: googleProfile.idToken })
      });

      if (res.success && res.data?.token) {
        localStorage.setItem('aether_token', res.data.token);
        setUser(res.data.user);
        return { success: true };
      }

      return {
        success: false,
        message: res.error?.message || 'Failed to authenticate with Google.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Google Sign-In failed.'
      };
    }
  };

  // Discord OAuth Login Flow (Popup postMessage handler)
  const loginWithDiscord = async (): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await apiRequest('/auth/discord/url');
      if (!res.success || !res.data?.url) {
        return {
          success: false,
          message: res.error?.message || 'Discord authentication is currently unavailable or unconfigured.'
        };
      }

      const authUrl = res.data.url;
      const width = 500;
      const height = 750;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      return new Promise<{ success: boolean; message?: string }>((resolve) => {
        const popup = window.open(
          authUrl,
          'DiscordAuthPopup',
          `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=yes`
        );

        if (!popup) {
          return resolve({
            success: false,
            message: 'Popup blocked by your browser. Please allow popups to sign in with Discord.'
          });
        }

        let settled = false;
        let checkPopupClosed: ReturnType<typeof setInterval> | undefined;
        const finish = (result: { success: boolean; message?: string }) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', handleMessage);
          if (checkPopupClosed) clearInterval(checkPopupClosed);
          resolve(result);
        };

        function handleMessage(event: MessageEvent) {
          if (event.origin !== window.location.origin) return;
          const type = event.data?.type;
          if ((type === 'MONONODE_DISCORD_OAUTH_SUCCESS' || type === 'DISCORD_AUTH_SUCCESS') && event.data?.token) {
            try { localStorage.setItem('aether_token', event.data.token); } catch { /* the cookie still carries the session */ }
            setUser(event.data.user);
            finish({ success: true });
          } else if (type === 'MONONODE_DISCORD_OAUTH_ERROR' || type === 'DISCORD_AUTH_ERROR') {
            finish({ success: false, message: event.data?.error || 'Discord authentication failed.' });
          }
        }

        window.addEventListener('message', handleMessage);

        checkPopupClosed = setInterval(() => {
          if (!popup.closed) return;
          clearInterval(checkPopupClosed);
          // Some browsers cut the popup's link to this window after it visited discord.com, so the success message can
          // never arrive. The server has already set the session cookie by then: ask it instead of giving up.
          setTimeout(async () => {
            if (settled) return;
            const me = await apiRequest('/auth/me');
            if (settled) return;
            if (me.success && me.data?.user) {
              setUser(me.data.user);
              finish({ success: true });
            } else {
              finish({ success: false, message: 'Discord sign-in window closed.' });
            }
          }, 600);
        }, 500);
      });
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to initiate Discord login.'
      };
    }
  };

  const logout = async () => {
    await apiRequest('/auth/logout', { method: 'POST' });
    try { localStorage.removeItem('aether_token'); } catch { /* ignore */ }
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchCurrentUser();
  };

  const updateUser = (updated: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updated } : null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authConfig,
        login,
        register,
        loginWithGoogle,
        loginWithDiscord,
        logout,
        refreshUser,
        updateUser,
        refreshAuthConfig: fetchAuthConfig
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
