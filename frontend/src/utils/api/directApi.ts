import type { ChatMessage, ChatGenerationOptions, ChatSession, SessionFolder, ApiResponse } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('direct-api');

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  models: string[];
}

const STORAGE_KEY = 'libre-webui-providers';
const SESSIONS_KEY = 'libre-webui-sessions';
const FOLDERS_KEY = 'libre-webui-folders';

function getProviders(): ProviderConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveProviders(providers: ProviderConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

function getActiveProvider(): ProviderConfig | null {
  const providers = getProviders();
  if (providers.length === 0) return null;
  const activeId = localStorage.getItem('libre-webui-active-provider');
  return providers.find(p => p.id === activeId) || providers[0];
}

function getStoredSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveStoredSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function getStoredFolders(): SessionFolder[] {
  try {
    const stored = localStorage.getItem(FOLDERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveStoredFolders(folders: SessionFolder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Build OpenAI-compatible request body
function buildRequestBody(
  messages: Array<{ role: string; content: string }>,
  model: string,
  options?: Record<string, unknown>
) {
  return {
    model,
    messages,
    stream: true,
    temperature: (options?.temperature as number) ?? 0.7,
    max_tokens: (options?.max_tokens as number) ?? 4096,
    top_p: options?.top_p as number | undefined,
    frequency_penalty: options?.frequency_penalty as number | undefined,
    presence_penalty: options?.presence_penalty as number | undefined,
  };
}

// Build Anthropic request body
function buildAnthropicRequestBody(
  messages: Array<{ role: string; content: string }>,
  model: string,
  systemPrompt: string,
  options?: Record<string, unknown>
) {
  return {
    model,
    messages,
    max_tokens: (options?.max_tokens as number) ?? 4096,
    temperature: (options?.temperature as number) ?? 0.7,
    top_p: options?.top_p as number | undefined,
    stream: true,
    system: systemPrompt || undefined,
  };
}

// Parse OpenAI SSE stream
async function* parseOpenAIStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          yield { content: delta.content };
        }
        if (parsed.usage) {
          yield { usage: parsed.usage };
        }
      } catch {
        // skip malformed chunks
      }
    }
  }
}

// Parse Anthropic SSE stream
async function* parseAnthropicStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let eventType = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('event: ')) {
        eventType = trimmed.slice(7);
      } else if (trimmed.startsWith('data: ') && eventType === 'content_block_delta') {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          if (parsed.delta?.text) {
            yield { content: parsed.delta.text };
          }
        } catch {
          // skip
        }
      } else if (trimmed.startsWith('data: ') && eventType === 'message_stop') {
        return;
      }
    }
  }
}

export const directApi = {
  // Provider management
  getProviders,
  saveProviders,
  getActiveProvider,
  setActiveProvider: (id: string) => localStorage.setItem('libre-webui-active-provider', id),

  addProvider: (config: Omit<ProviderConfig, 'id'>): ProviderConfig => {
    const providers = getProviders();
    const newProvider: ProviderConfig = {
      ...config,
      id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    providers.push(newProvider);
    saveProviders(providers);
    if (providers.length === 1) {
      localStorage.setItem('libre-webui-active-provider', newProvider.id);
    }
    return newProvider;
  },

  updateProvider: (id: string, updates: Partial<ProviderConfig>) => {
    const providers = getProviders();
    const idx = providers.findIndex(p => p.id === id);
    if (idx !== -1) {
      providers[idx] = { ...providers[idx], ...updates };
      saveProviders(providers);
    }
  },

  deleteProvider: (id: string) => {
    const providers = getProviders().filter(p => p.id !== id);
    saveProviders(providers);
    if (localStorage.getItem('libre-webui-active-provider') === id) {
      localStorage.removeItem('libre-webui-active-provider');
    }
  },

  // Streaming chat - makes direct API call
  streamChat: async (
    messages: ChatMessage[],
    model: string,
    options?: Record<string, unknown>,
    onChunk?: (content: string) => void,
    onComplete?: (fullContent: string, usage?: { prompt_tokens: number; completion_tokens: number }) => void,
    onError?: (error: Error) => void
  ): Promise<() => void> => {
    const provider = getActiveProvider();
    if (!provider) {
      onError?.(new Error('No provider configured. Add one in Settings.'));
      return () => {};
    }

    // Build message history for API
    const apiMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Add system prompt if available
    const systemPrompt = (options?.systemPrompt as string) || '';
    if (systemPrompt && provider.type === 'anthropic') {
      // Anthropic handles system separately
    }

    const abortController = new AbortController();
    let fullContent = '';

    (async () => {
      try {
        let response: Response;

        if (provider.type === 'anthropic') {
          response = await fetch(`${provider.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': provider.apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(buildAnthropicRequestBody(apiMessages, model, systemPrompt, options)),
            signal: abortController.signal,
          });
        } else {
          // OpenAI-compatible (OpenAI, OpenRouter, Ollama, custom)
          response = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(buildRequestBody(apiMessages, model, options)),
            signal: abortController.signal,
          });
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const stream = provider.type === 'anthropic'
          ? parseAnthropicStream(reader)
          : parseOpenAIStream(reader);

        let lastChunk: { content?: string; usage?: { prompt_tokens: number; completion_tokens: number } } = {};
        for await (const chunk of stream) {
          if (chunk.content) {
            fullContent += chunk.content;
            onChunk?.(fullContent);
          }
          lastChunk = chunk;
        }

        onComplete?.(fullContent, lastChunk.usage);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          onError?.(error as Error);
        }
      }
    })();

    return () => abortController.abort();
  },

  // Generate a title for a conversation
  generateTitle: async (firstMessage: string): Promise<string> => {
    const provider = getActiveProvider();
    if (!provider) return firstMessage.slice(0, 50);

    try {
      let title = '';
      await directApi.streamChat(
        [{ id: '1', role: 'user', content: firstMessage, timestamp: Date.now() }],
        provider.models[0] || 'gpt-3.5-turbo',
        { max_tokens: 50, temperature: 0.3 },
        (content) => { title = content; },
        () => {},
        () => {}
      );
      // Wait a bit for streaming to complete
      await new Promise(r => setTimeout(r, 2000));
      return title || firstMessage.slice(0, 50);
    } catch {
      return firstMessage.slice(0, 50);
    }
  },

  // Session management (localStorage)
  getSessions: async (): Promise<ApiResponse<ChatSession[]>> => {
    return { success: true, data: getStoredSessions() };
  },

  createSession: async (
    model: string,
    title?: string,
    _personaId?: string,
    _providerType?: string | null,
    _providerId?: string | null
  ): Promise<ApiResponse<ChatSession>> => {
    const sessions = getStoredSessions();
    const newSession: ChatSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title || 'New Chat',
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    sessions.unshift(newSession);
    saveStoredSessions(sessions);
    return { success: true, data: newSession };
  },

  updateSession: async (
    sessionId: string,
    updates: Partial<ChatSession>
  ): Promise<ApiResponse<ChatSession>> => {
    const sessions = getStoredSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return { success: false, error: 'Session not found' };
    sessions[idx] = { ...sessions[idx], ...updates, updatedAt: Date.now() };
    saveStoredSessions(sessions);
    return { success: true, data: sessions[idx] };
  },

  deleteSession: async (sessionId: string): Promise<ApiResponse> => {
    const sessions = getStoredSessions().filter(s => s.id !== sessionId);
    saveStoredSessions(sessions);
    return { success: true };
  },

  updateMessage: async (
    sessionId: string,
    messageId: string,
    updates: Partial<ChatMessage>
  ): Promise<ApiResponse<ChatMessage>> => {
    const sessions = getStoredSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return { success: false, error: 'Session not found' };
    const msg = session.messages.find(m => m.id === messageId);
    if (!msg) return { success: false, error: 'Message not found' };
    Object.assign(msg, updates);
    saveStoredSessions(sessions);
    return { success: true, data: msg };
  },

  clearAllSessions: async (): Promise<ApiResponse> => {
    saveStoredSessions([]);
    return { success: true };
  },

  // Folders
  getFolders: async (): Promise<ApiResponse<SessionFolder[]>> => {
    return { success: true, data: getStoredFolders() };
  },

  createFolder: async (name: string): Promise<ApiResponse<SessionFolder>> => {
    const folders = getStoredFolders();
    const newFolder: SessionFolder = {
      id: `folder-${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    folders.push(newFolder);
    saveStoredFolders(folders);
    return { success: true, data: newFolder };
  },

  renameFolder: async (folderId: string, name: string): Promise<ApiResponse<SessionFolder>> => {
    const folders = getStoredFolders();
    const idx = folders.findIndex(f => f.id === folderId);
    if (idx === -1) return { success: false, error: 'Folder not found' };
    folders[idx].name = name;
    saveStoredFolders(folders);
    return { success: true, data: folders[idx] };
  },

  deleteFolder: async (folderId: string): Promise<ApiResponse> => {
    const folders = getStoredFolders().filter(f => f.id !== folderId);
    saveStoredFolders(folders);
    return { success: true };
  },

  // Models - return configured provider models
  getModels: async (): Promise<ApiResponse<Array<{ id: string; name: string; provider: string }>>> => {
    const providers = getProviders();
    const models = providers.flatMap(p =>
      p.models.map(m => ({
        id: m,
        name: m,
        provider: p.name,
      }))
    );
    return { success: true, data: models };
  },
};
