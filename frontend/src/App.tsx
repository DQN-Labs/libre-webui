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

import React, { useState, Suspense, useEffect } from 'react';
import {
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
  Routes,
  Route,
  useNavigate,
} from 'react-router';

// Initialize i18n
import '@/i18n';
import { isRTL } from '@/i18n';
import { useTranslation } from 'react-i18next';

const isElectron = window.location.protocol === 'file:';

// Draggable title bar area for Electron macOS
const ElectronTitleBar: React.FC = () => {
  if (!isElectron) return null;
  return (
    <div
      className='absolute top-0 left-0 right-0 h-8 z-50'
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    />
  );
};
import { Toaster } from 'react-hot-toast';
import { Sidebar } from '@/components/Sidebar';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { useWhatsNew } from '@/hooks/useWhatsNew';
import { BackgroundRenderer } from '@/components/BackgroundRenderer';
import { AppTabBar } from '@/components/AppTabBar';
import { startNewChat, startNewWork } from '@/utils/appNavigation';
import { CommandPalette } from '@/components/CommandPalette';
import { LogoMark } from '@/components/LogoMark';
import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import { useInitializeApp } from '@/hooks/useInitializeApp';
import { directApi } from '@/utils/api/directApi';
import {
  useKeyboardShortcuts,
  KeyboardShortcut,
} from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/utils';
import { createLogger } from '@/utils/logger';
import toast from 'react-hot-toast';

const logger = createLogger('app');

// Lazy load pages for code splitting
const HomePage = React.lazy(() => import('@/pages/HomePage'));
const ChatPage = React.lazy(() => import('@/pages/ChatPage'));
const ModelsPage = React.lazy(() => import('@/pages/ModelsPage'));
const PersonasPage = React.lazy(() => import('@/pages/PersonasPage'));
const GalleryPage = React.lazy(() => import('@/pages/GalleryPage'));
const NotesPage = React.lazy(() => import('@/pages/NotesPage'));
const LibreClawPage = React.lazy(() => import('@/pages/LibreClawPage'));
const WorkPage = React.lazy(() => import('@/pages/WorkPage'));
const UserManagementPage = React.lazy(
  () => import('@/pages/UserManagementPage')
);
const PluginUsagePage = React.lazy(() => import('@/pages/PluginUsagePage'));
const SystemPage = React.lazy(() => import('@/pages/SystemPage'));
const ArtifactDemoPage = React.lazy(() => import('@/pages/ArtifactDemoPage'));
const SettingsModal = React.lazy(() =>
  import('@/components/SettingsModal').then(module => ({
    default: module.SettingsModal,
  }))
);
const ArtifactSlideOutPanel = React.lazy(() =>
  import('@/components/ArtifactSlideOutPanel').then(module => ({
    default: module.ArtifactSlideOutPanel,
  }))
);
const ProviderSettings = React.lazy(() =>
  import('@/components/ProviderSettings').then(module => ({
    default: module.ProviderSettings,
  }))
);

// Import LoginPage directly (not lazy) to avoid suspense issues during auth redirects
import { LoginPage } from '@/pages/LoginPage';

// Loading component
const PageLoader = () => {
  const { t } = useTranslation();
  return (
    <div className='flex h-full min-h-screen items-center justify-center bg-gray-50 dark:bg-dark-100'>
      <div className='flex flex-col items-center gap-3'>
        <div className='h-8 w-8 rounded-full border-4 border-gray-200 border-t-primary-500 animate-spin dark:border-dark-300 dark:border-t-primary-400'></div>
        <div className='text-gray-600 dark:text-dark-600'>
          {t('common.loading')}
        </div>
      </div>
    </div>
  );
};

const SidebarLayoutSpacer: React.FC<{ isOpen: boolean; compact: boolean }> = ({
  isOpen,
  compact,
}) => (
  <div
    aria-hidden='true'
    className={cn(
      'hidden lg:block flex-shrink-0 transition-[width] duration-200 ease-out',
      isOpen ? (compact ? 'w-20' : 'w-72') : 'w-0'
    )}
  />
);

interface ShellLayoutProps {
  hasBackground: boolean;
  sidebarOpen: boolean;
  sidebarCompact: boolean;
  onCloseSidebar: () => void;
  showDemoBanner: boolean;
  demoMessage?: string;
  children: React.ReactNode;
}

// The single app frame: sidebar + tab strip + routed content card.
const ShellLayout: React.FC<ShellLayoutProps> = ({
  hasBackground,
  sidebarOpen,
  sidebarCompact,
  onCloseSidebar,
  showDemoBanner,
  demoMessage,
  children,
}) => (
  <div
    className={cn(
      'flex h-dvh min-h-0 text-gray-950 dark:text-dark-900 relative overflow-hidden',
      hasBackground
        ? 'bg-gray-100/60 dark:bg-dark-50/60'
        : 'bg-gray-100 dark:bg-dark-50'
    )}
  >
    <ElectronTitleBar />
    <BackgroundRenderer />
    <Sidebar isOpen={sidebarOpen} onClose={onCloseSidebar} />
    <SidebarLayoutSpacer isOpen={sidebarOpen} compact={sidebarCompact} />
    <div
      data-testid='app-shell-content'
      className={cn(
        'flex-1 basis-0 flex min-h-0 flex-col min-w-0 transition-[margin,background-color] duration-200 ease-out relative z-10 lg:pb-2 lg:pe-2',
        isElectron ? 'pt-8' : 'lg:pt-1.5',
        // Mobile behavior:
        // - Compact sidebar: push content away to avoid overlap
        // - Expanded sidebar: overlay (no transform)
        sidebarOpen && sidebarCompact ? 'max-lg:ms-20' : 'max-lg:ms-0',
        hasBackground ? 'bg-white/10 dark:bg-dark-50/10' : 'bg-transparent'
      )}
    >
      <AppTabBar />
      <main
        className={cn(
          'min-h-0 flex-1 overflow-hidden lg:rounded-[1.5rem] lg:border lg:border-black/[0.06] dark:lg:border-white/[0.07] lg:shadow-[0_1px_2px_rgba(0,0,0,0.03),0_18px_60px_rgba(15,23,42,0.04)]',
          hasBackground
            ? 'bg-white/30 dark:bg-dark-100/35 backdrop-blur-sm'
            : 'bg-gray-50 dark:bg-dark-100'
        )}
      >
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>{children}</Suspense>
        </ErrorBoundary>
      </main>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [hasProviders, setHasProviders] = useState(() => {
    return directApi.getProviders().length > 0;
  });
  const {
    sidebarOpen,
    sidebarCompact,
    setSidebarOpen,
    setSidebarCompact,
    toggleSidebar,
    toggleSidebarCompact,
    toggleTheme,
    backgroundImage,
    preferences,
    artifactPanelOpen,
  } = useAppStore();
  const {
    isAuthenticated,
  } = useAuthStore();
  const hasWorkspaceAccess = true;
  const whatsNew = useWhatsNew();

  // Initialize the app
  useInitializeApp();

  // Check providers on mount
  useEffect(() => {
    setHasProviders(directApi.getProviders().length > 0);
  }, []);

  // Check if any background is active (persona background or general background settings)
  const hasActiveBackground = () => {
    // Persona background takes priority
    if (backgroundImage) {
      return true;
    }

    // Check general background settings
    const backgroundSettings = preferences.backgroundSettings;
    return backgroundSettings?.enabled && backgroundSettings?.imageUrl;
  };

  // Define keyboard shortcuts
  const shortcuts: KeyboardShortcut[] = [
    {
      key: 'b',
      metaKey: true,
      action: () => {
        // On desktop (lg screens), always keep sidebar open and toggle compact mode
        // On mobile, allow closing/opening the sidebar
        if (window.innerWidth >= 1024) {
          // lg breakpoint
          // Desktop behavior: If closed, open in expanded mode, otherwise toggle compact
          if (!sidebarOpen) {
            setSidebarCompact(false);
            toggleSidebar();
          } else {
            toggleSidebarCompact();
          }
        } else {
          // Mobile behavior: Toggle open/closed, always open in expanded mode
          if (!sidebarOpen && sidebarCompact) {
            setSidebarCompact(false);
          }
          toggleSidebar();
        }
      },
      description: t('keyboard.toggleSidebar'),
    },
    {
      key: ',',
      metaKey: true,
      action: () => {
        setSettingsTab(undefined);
        setSettingsOpen(true);
      },
      description: t('keyboard.openSettings'),
    },
    {
      key: 'o',
      metaKey: true,
      shiftKey: true,
      action: () => startNewChat(navigate),
      description: t('keyboard.newChat'),
    },
    {
      key: 'u',
      metaKey: true,
      shiftKey: true,
      action: () => {
        if (useAuthStore.getState().canUseWork()) {
          startNewWork(navigate);
        }
      },
      description: t('keyboard.newWork'),
    },
    {
      key: 'd',
      metaKey: true,
      action: toggleTheme,
      description: t('keyboard.toggleDarkMode'),
    },
    {
      key: 'h',
      action: () => {
        setSettingsTab('shortcuts');
        setSettingsOpen(true);
      },
      description: t('keyboard.showShortcuts'),
    },
    {
      key: 'Escape',
      action: () => setSettingsOpen(false),
      description: t('keyboard.closeModals'),
    },
  ];

  // Enable keyboard shortcuts
  useKeyboardShortcuts(shortcuts, hasWorkspaceAccess);

  // Show provider setup if no providers configured
  if (!hasProviders) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ProviderSettings onComplete={() => setHasProviders(true)} />
      </Suspense>
    );
  }

  return (
    <>
      {/* Full layout - no auth required */}
      <ShellLayout
        hasBackground={!!hasActiveBackground()}
        sidebarOpen={sidebarOpen}
        sidebarCompact={sidebarCompact}
        onCloseSidebar={() => setSidebarOpen(false)}
        showDemoBanner={false}
      >
        <Routes>
          <Route path='/' element={<HomePage />} />
          <Route path='/chat' element={<ChatPage />} />
          <Route path='/c/:sessionId' element={<ChatPage />} />
          <Route path='/models' element={<ModelsPage />} />
          <Route path='/personas' element={<PersonasPage />} />
          <Route path='/gallery' element={<GalleryPage />} />
          <Route path='/notes' element={<NotesPage />} />
          <Route path='/artifacts' element={<ArtifactDemoPage />} />
        </Routes>
      </ShellLayout>

      {/* Modals */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={settingsOpen}
            initialTab={settingsTab}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}

      {hasWorkspaceAccess && whatsNew.open && whatsNew.notes && (
        <WhatsNewModal notes={whatsNew.notes} onDismiss={whatsNew.dismiss} />
      )}

      {/* Artifact slide-out panel */}
      {hasWorkspaceAccess && artifactPanelOpen && (
        <Suspense fallback={null}>
          <ArtifactSlideOutPanel />
        </Suspense>
      )}

      <Toaster
        position={isRTL(i18n.language) ? 'top-left' : 'top-right'}
        toastOptions={{
          duration: 4000,
          className: 'animate-slide-up',
          style: {
            background: 'var(--toast-bg)',
            color: 'var(--toast-color)',
            border: '1px solid var(--toast-border)',
            borderRadius: '0.75rem',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            cursor: 'pointer',
          },
          success: {
            iconTheme: {
              primary: 'rgb(var(--color-primary-600))',
              secondary: '#ffffff',
            },
          },
          error: {
            iconTheme: {
              primary: 'rgb(var(--color-primary-600))',
              secondary: '#ffffff',
            },
          },
        }}
        containerStyle={{
          top: 80, // Position below header (header height + some margin)
          insetInlineEnd: 20,
        }}
      />

      {hasWorkspaceAccess && (
        <CommandPalette onOpenSettings={() => setSettingsOpen(true)} />
      )}
    </>
  );
};

// Data routers support navigation blockers used by the Work file editor.
// Electron still uses hash-based URLs because file:// cannot serve history
// fallbacks.
const appRouter = isElectron
  ? createHashRouter([{ path: '*', element: <AppContent /> }])
  : createBrowserRouter([{ path: '*', element: <AppContent /> }]);

const App: React.FC = () => (
  <ErrorBoundary>
    <RouterProvider router={appRouter} />
  </ErrorBoundary>
);

export default App;
