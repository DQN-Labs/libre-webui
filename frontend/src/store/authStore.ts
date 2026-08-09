/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at:
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, SystemInfo } from '@/types';
import type { WorkAccess } from '@/types/work';

interface AuthState {
  user: User | null;
  token: string | null;
  systemInfo: SystemInfo | null;
  workAccess: WorkAccess | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string, systemInfo: SystemInfo) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setSystemInfo: (systemInfo: SystemInfo) => void;
  setLoading: (loading: boolean) => void;
  isAdmin: () => boolean;
  requiresAuth: () => boolean;
  canUseWork: () => boolean;
  canUseAgents: () => boolean;
  refreshWorkAccess: () => Promise<void>;
}

// No-auth mode: always authenticated, no backend required
const NO_AUTH_SYSTEM_INFO = {
  requiresAuth: false,
  hasUsers: false,
  version: '1.0.0',
  defaultModel: '',
  agentsEnabled: false,
  userCount: 0,
  signupEnabled: false,
} as SystemInfo;

const LOCAL_USER = {
  id: 'local-user',
  username: 'User',
  email: '',
  role: 'admin',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as User;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: LOCAL_USER,
      token: 'local-token',
      systemInfo: NO_AUTH_SYSTEM_INFO,
      workAccess: { allowed: true } as WorkAccess,
      isAuthenticated: true,
      isLoading: false,

      login: (_user: User, _token: string, _systemInfo: SystemInfo) => {
        set({
          user: LOCAL_USER,
          token: 'local-token',
          systemInfo: NO_AUTH_SYSTEM_INFO,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      logout: () => {
        // In no-auth mode, logout does nothing meaningful
        set({
          user: LOCAL_USER,
          token: 'local-token',
          systemInfo: NO_AUTH_SYSTEM_INFO,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      setUser: (user: User) => set({ user }),

      setSystemInfo: (systemInfo: SystemInfo) => set({ systemInfo }),

      setLoading: (loading: boolean) => set({ isLoading: loading }),

      isAdmin: () => true,

      requiresAuth: () => false,

      canUseWork: () => true,

      canUseAgents: () => false,

      refreshWorkAccess: async () => {
        set({ workAccess: { allowed: true } as WorkAccess });
      },
    }),
    {
      name: 'auth-store',
      partialize: state => ({
        user: state.user,
        token: state.token,
        systemInfo: state.systemInfo,
        workAccess: state.workAccess,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
