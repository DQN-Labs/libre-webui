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

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useAppStore } from '@/store/appStore';
import { createLogger } from '@/utils/logger';
import { directApi } from '@/utils/api/directApi';
import {
  chatModelSelectionFromModel,
} from '@/utils/chatModelSelection';
import type { OllamaModel } from '@/types';

const logger = createLogger('initialize');

export const useInitializeApp = () => {
  const initialized = useRef(false);
  const initializing = useRef(false);
  const {
    loadSessions,
    loadPreferences: loadChatPreferences,
    setSelectedModel,
    models,
  } = useChatStore();
  const { loadPreferences: loadAppPreferences } = useAppStore();

  useEffect(() => {
    if (initialized.current || initializing.current) return;

    const initialize = async () => {
      initializing.current = true;
      try {
        logger.debug('Initializing (no-backend mode)...');

        // Load preferences first
        await Promise.all([loadAppPreferences(), loadChatPreferences()]);

        // Load sessions from localStorage
        await loadSessions();

        // Load models from configured providers
        const modelsResponse = await directApi.getModels();
        if (modelsResponse.success && modelsResponse.data) {
          const ollamaModels: OllamaModel[] = modelsResponse.data.map(m => ({
            name: m.id,
            model: m.id,
            size: 0,
            digest: '',
            modified_at: '',
            details: {},
          }));

          useChatStore.setState({ models: ollamaModels });

          // Set default model if none selected
          const { selectedModel } = useChatStore.getState();
          if (!selectedModel && ollamaModels.length > 0) {
            const fallback = chatModelSelectionFromModel(ollamaModels[0]);
            setSelectedModel(fallback.model, fallback.providerType, fallback.providerId);
          }
        }

        initialized.current = true;
        logger.debug('App initialized successfully (no-backend mode)');
      } catch (error) {
        logger.error('Failed to initialize app:', error);
      } finally {
        initializing.current = false;
      }
    };

    initialize();
  }, [loadAppPreferences, loadChatPreferences, loadSessions, setSelectedModel]);

  // Set default model when models are loaded
  useEffect(() => {
    if (models.length > 0) {
      const chatModels = models.filter(m => !m.name.includes('embed'));
      const fallback = chatModels[0] || models[0];

      const {
        selectedModel: currentSelected,
        selectedProviderType,
        selectedProviderId,
      } = useChatStore.getState();

      if (!currentSelected) {
        const fallbackSelection = chatModelSelectionFromModel(fallback);
        logger.debug('No model selected, using first available:', fallbackSelection.model);
        setSelectedModel(
          fallbackSelection.model,
          fallbackSelection.providerType,
          fallbackSelection.providerId
        );
      }
    }
  }, [models, setSelectedModel]);
};
