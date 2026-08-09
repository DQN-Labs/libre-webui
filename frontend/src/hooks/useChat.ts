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

import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useAppStore } from '@/store/appStore';
import { ToolActivity } from '@/types';
import { generateId } from '@/utils';
import {
  trackThinkingProgress,
  takeThinkingDuration,
} from '@/utils/thinkingTimer';
import { isDemoMode } from '@/utils/demoMode';
import { createLogger } from '@/utils/logger';
import toast from 'react-hot-toast';
import { directApi } from '@/utils/api/directApi';

const logger = createLogger('use-chat');
const DEFAULT_SESSION_TITLES = new Set(['New Chat', 'New Demo Session']);

const isDefaultSessionTitle = (title?: string) =>
  !title || DEFAULT_SESSION_TITLES.has(title);

export const useChat = (sessionId: string) => {
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [streamingThinking, setStreamingThinking] = useState<string>('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const {
    addMessage,
    updateMessage,
    updateMessageWithStatistics,
    applySessionTitle,
    setGeneratingTitleForSession,
  } = useChatStore();
  const { setIsGenerating } = useAppStore();
  const streamingMessageIdRef = useRef<string | null>(null);

  // Track the first user message for auto-title generation
  const firstUserMessageRef = useRef<string | null>(null);
  const shouldGenerateTitleRef = useRef(false);
  const titleGenerationSessionRef = useRef<string | null>(null);

  // Buffer for streaming content to reduce state updates
  const streamingContentRef = useRef<string>('');
  const streamingThinkingRef = useRef<string>('');

  // Store update batching with debounced timer approach
  const lastStoreUpdate = useRef<number>(0);
  const storeUpdateTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const streamingFrameRef = useRef<number | null>(null);
  const pendingStreamingContentRef = useRef<string>('');
  const pendingStreamingThinkingRef = useRef<string>('');

  // Abort controller for cancelling streams
  const abortRef = useRef<(() => void) | null>(null);

  const cancelQueuedStreamingFrame = useCallback(() => {
    if (streamingFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(streamingFrameRef.current);
    }
    streamingFrameRef.current = null;
  }, []);

  const publishStreamingMessage = useCallback(
    (content: string, immediate = false, thinking: string = '') => {
      pendingStreamingContentRef.current = content;
      pendingStreamingThinkingRef.current = thinking;

      if (immediate || typeof window === 'undefined') {
        cancelQueuedStreamingFrame();
        setStreamingMessage(content);
        setStreamingThinking(thinking);
        return;
      }

      if (streamingFrameRef.current !== null) {
        return;
      }

      streamingFrameRef.current = window.requestAnimationFrame(() => {
        streamingFrameRef.current = null;
        setStreamingMessage(pendingStreamingContentRef.current);
        setStreamingThinking(pendingStreamingThinkingRef.current);
      });
    },
    [cancelQueuedStreamingFrame]
  );

  const resetVisibleStreamingMessage = useCallback(() => {
    cancelQueuedStreamingFrame();
    pendingStreamingContentRef.current = '';
    pendingStreamingThinkingRef.current = '';
    setStreamingMessage('');
    setStreamingThinking('');
  }, [cancelQueuedStreamingFrame]);

  const clearQueuedTitleGeneration = useCallback(() => {
    firstUserMessageRef.current = null;
    shouldGenerateTitleRef.current = false;
    titleGenerationSessionRef.current = null;
  }, []);

  const maybeGenerateTitle = useCallback(
    async (targetSessionId: string) => {
      const currentPrefs = useAppStore.getState().preferences;
      const titleSettings = currentPrefs.titleSettings;
      const firstMessage = firstUserMessageRef.current;
      const shouldGenerateTitle =
        shouldGenerateTitleRef.current &&
        titleGenerationSessionRef.current === targetSessionId;

      if (
        !firstMessage ||
        !shouldGenerateTitle ||
        !titleSettings?.autoTitle
      ) {
        clearQueuedTitleGeneration();
        return;
      }

      clearQueuedTitleGeneration();
      setGeneratingTitleForSession(targetSessionId);

      try {
        const title = await directApi.generateTitle(firstMessage);
        applySessionTitle(targetSessionId, title, Date.now());
        toast.success('Chat title generated');
      } catch (error) {
        logger.error('Failed to generate title:', error);
        toast.error('Failed to generate chat title');
      } finally {
        setGeneratingTitleForSession(null);
      }
    },
    [
      applySessionTitle,
      clearQueuedTitleGeneration,
      setGeneratingTitleForSession,
    ]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.();
      if (storeUpdateTimer.current) {
        clearTimeout(storeUpdateTimer.current);
      }
      cancelQueuedStreamingFrame();
    };
  }, [cancelQueuedStreamingFrame]);

  const sendMessage = useCallback(
    async (
      content: string,
      images?: string[],
      _format?: string | Record<string, unknown>,
      _webSearch?: boolean
    ) => {
      if (!sessionId || (!content.trim() && (!images || images.length === 0)))
        return;

      try {
        const chatState = useChatStore.getState();
        const session = chatState.currentSession;

        setIsGenerating(true);
        setIsStreaming(true);
        resetVisibleStreamingMessage();

        // Reset batching timers for new stream
        if (storeUpdateTimer.current) {
          clearTimeout(storeUpdateTimer.current);
        }
        lastStoreUpdate.current = Date.now();

        // Track the first user message for auto-title generation
        const hasExistingUserMessages = session?.messages?.some(
          m => m.role === 'user'
        );
        const shouldTrackFirstMessage =
          !hasExistingUserMessages &&
          isDefaultSessionTitle(session?.title);

        if (shouldTrackFirstMessage) {
          firstUserMessageRef.current = content.trim();
          shouldGenerateTitleRef.current = true;
          titleGenerationSessionRef.current = sessionId;
        } else {
          firstUserMessageRef.current = null;
          shouldGenerateTitleRef.current = false;
          titleGenerationSessionRef.current = null;
        }

        // Add user message immediately
        addMessage(sessionId, {
          role: 'user',
          content: content.trim(),
          images: images,
        });

        // Create placeholder for assistant message
        const assistantMessageId = generateId();
        streamingMessageIdRef.current = assistantMessageId;
        streamingThinkingRef.current = '';
        setStreamingMessageId(assistantMessageId);

        addMessage(sessionId, {
          role: 'assistant',
          content: '',
          id: assistantMessageId,
        });

        if (isDemoMode()) {
          const demoResponse = `Demo response for: ${content.trim()}`;
          window.setTimeout(() => {
            updateMessage(sessionId, assistantMessageId, demoResponse);
            setIsStreaming(false);
            resetVisibleStreamingMessage();
            setStreamingMessageId(null);
            setIsGenerating(false);
            maybeGenerateTitle(sessionId);
            streamingMessageIdRef.current = null;
            streamingContentRef.current = '';
            streamingThinkingRef.current = '';
          }, 500);
          return;
        }

        // Get all messages for context
        const allMessages = useChatStore.getState().currentSession?.messages || [];
        const model = session?.model || 'gpt-3.5-turbo';

        // Stream directly from provider
        abortRef.current = await directApi.streamChat(
          allMessages,
          model,
          session?.settings?.generationOptions,
          // onChunk
          (fullContent) => {
            streamingContentRef.current = fullContent;
            publishStreamingMessage(fullContent);

            if (storeUpdateTimer.current) {
              clearTimeout(storeUpdateTimer.current);
            }
            storeUpdateTimer.current = setTimeout(
              () => {
                updateMessage(sessionId, assistantMessageId, streamingContentRef.current);
                lastStoreUpdate.current = Date.now();
              },
              200
            );
          },
          // onComplete
          (fullContent, usage) => {
            setIsStreaming(false);
            resetVisibleStreamingMessage();
            setIsGenerating(false);
            setToolActivities([]);

            const finalContent = streamingContentRef.current || fullContent;
            const thinkingDurationMs = takeThinkingDuration(assistantMessageId);

            const statistics = usage ? {
              prompt_eval_count: usage.prompt_tokens,
              eval_count: usage.completion_tokens,
              thinking_duration_ms: thinkingDurationMs,
            } : thinkingDurationMs !== undefined ? {
              thinking_duration_ms: thinkingDurationMs,
            } : undefined;

            updateMessageWithStatistics(
              sessionId,
              assistantMessageId,
              finalContent,
              statistics,
              undefined,
              undefined
            );

            maybeGenerateTitle(sessionId);

            streamingMessageIdRef.current = null;
            streamingContentRef.current = '';
            streamingThinkingRef.current = '';

            if (storeUpdateTimer.current) {
              clearTimeout(storeUpdateTimer.current);
            }
            lastStoreUpdate.current = 0;
          },
          // onError
          (error) => {
            setIsStreaming(false);
            resetVisibleStreamingMessage();
            setIsGenerating(false);
            streamingMessageIdRef.current = null;
            streamingThinkingRef.current = '';
            toast.error(error.message || 'Failed to send message');
            clearQueuedTitleGeneration();
          }
        );
      } catch (error: unknown) {
        logger.error('Failed to send message:', error);
        setIsStreaming(false);
        resetVisibleStreamingMessage();
        setStreamingMessageId(null);
        setIsGenerating(false);
        streamingMessageIdRef.current = null;
        streamingThinkingRef.current = '';
        toast.error('Failed to send message');
      }
    },
    [
      sessionId,
      addMessage,
      updateMessage,
      updateMessageWithStatistics,
      setIsGenerating,
      resetVisibleStreamingMessage,
      maybeGenerateTitle,
      publishStreamingMessage,
      clearQueuedTitleGeneration,
    ]
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
    resetVisibleStreamingMessage();
    setStreamingMessageId(null);
    setIsGenerating(false);
    streamingMessageIdRef.current = null;
    streamingThinkingRef.current = '';
  }, [setIsGenerating, resetVisibleStreamingMessage]);

  const regenerateLastMessage = useCallback(async () => {
    const chatState = useChatStore.getState();
    const session = chatState.currentSession;
    if (!session || !sessionId) return;

    const messages = session.messages;
    let lastUserMessageIndex = -1;
    let lastAssistantMessageIndex = -1;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantMessageIndex = i;
        break;
      }
    }
    if (lastAssistantMessageIndex > 0) {
      for (let i = lastAssistantMessageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserMessageIndex = i;
          break;
        }
      }
    }

    if (lastUserMessageIndex === -1 || lastAssistantMessageIndex === -1) {
      toast.error('No message to regenerate');
      return;
    }

    const lastUserMessage = messages[lastUserMessageIndex];

    try {
      setIsGenerating(true);
      setIsStreaming(true);
      resetVisibleStreamingMessage();

      if (storeUpdateTimer.current) {
        clearTimeout(storeUpdateTimer.current);
      }
      lastStoreUpdate.current = Date.now();

      const newBranchMessageId = generateId();
      streamingMessageIdRef.current = newBranchMessageId;
      streamingThinkingRef.current = '';
      setStreamingMessageId(newBranchMessageId);

      addMessage(sessionId, {
        role: 'assistant',
        content: '',
        id: newBranchMessageId,
      });

      const allMessages = useChatStore.getState().currentSession?.messages || [];
      const model = session.model || 'gpt-3.5-turbo';

      abortRef.current = await directApi.streamChat(
        allMessages.filter((_, i) => i < lastAssistantMessageIndex),
        model,
        session.settings?.generationOptions,
        (fullContent) => {
          streamingContentRef.current = fullContent;
          publishStreamingMessage(fullContent);

          if (storeUpdateTimer.current) {
            clearTimeout(storeUpdateTimer.current);
          }
          storeUpdateTimer.current = setTimeout(
            () => {
              updateMessage(sessionId, newBranchMessageId, streamingContentRef.current);
            },
            200
          );
        },
        (fullContent, usage) => {
          setIsStreaming(false);
          resetVisibleStreamingMessage();
          setIsGenerating(false);

          const statistics = usage ? {
            prompt_eval_count: usage.prompt_tokens,
            eval_count: usage.completion_tokens,
          } : undefined;

          updateMessageWithStatistics(
            sessionId,
            newBranchMessageId,
            fullContent,
            statistics
          );

          streamingMessageIdRef.current = null;
          streamingContentRef.current = '';
          if (storeUpdateTimer.current) clearTimeout(storeUpdateTimer.current);
        },
        (error) => {
          setIsStreaming(false);
          resetVisibleStreamingMessage();
          setIsGenerating(false);
          streamingMessageIdRef.current = null;
          toast.error(error.message || 'Failed to regenerate');
        }
      );
    } catch (error: unknown) {
      logger.error('Failed to regenerate message:', error);
      setIsStreaming(false);
      resetVisibleStreamingMessage();
      setStreamingMessageId(null);
      setIsGenerating(false);
      streamingMessageIdRef.current = null;
      toast.error('Failed to regenerate message');
    }
  }, [sessionId, setIsGenerating, resetVisibleStreamingMessage, addMessage, updateMessage, updateMessageWithStatistics, publishStreamingMessage]);

  const selectBranch = useCallback(
    async (messageId: string) => {
      const state = useChatStore.getState();
      const session = state.currentSession;
      if (!session || !sessionId) return;

      const message = session.messages.find(m => m.id === messageId);
      if (!message || message.isActive !== false) return;

      const parentId = message.parentId || message.id;
      const updatedMessages = session.messages.map(msg => {
        const isSibling = msg.id === parentId || msg.parentId === parentId;
        if (isSibling) {
          return { ...msg, isActive: msg.id === messageId };
        }
        return msg;
      });

      const updatedSession = {
        ...session,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      useChatStore.setState(prevState => ({
        sessions: prevState.sessions.map(s =>
          s.id === sessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));

      toast.success('Switched variant');
    },
    [sessionId]
  );

  const editAndResendMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (!sessionId || !newContent.trim()) return;

      const state = useChatStore.getState();
      const session = state.currentSession;
      if (!session || session.id !== sessionId) return;

      const index = session.messages.findIndex(m => m.id === messageId);
      if (index === -1 || session.messages[index].role !== 'user') return;

      const editedMessage = session.messages[index];
      state.truncateMessagesFrom(sessionId, messageId);
      await sendMessage(newContent, editedMessage.images);
    },
    [sessionId, sendMessage]
  );

  return {
    sendMessage,
    stopGeneration,
    regenerateLastMessage,
    editAndResendMessage,
    selectBranch,
    isStreaming,
    streamingMessage,
    streamingThinking,
    streamingMessageId,
    toolActivities,
  };
};
