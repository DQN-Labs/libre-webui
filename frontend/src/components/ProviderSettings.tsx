import React, { useState, useEffect } from 'react';
import { directApi, ProviderConfig } from '@/utils/api/directApi';
import { useChatStore } from '@/store/chatStore';
import { LogoMark } from '@/components/LogoMark';
import toast from 'react-hot-toast';

const PRESETS: Record<string, { name: string; baseUrl: string; models: string[] }> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514', 'google/gemini-2.0-flash-001'],
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  },
  ollama: {
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434',
    models: ['llama3.1', 'mistral', 'codellama'],
  },
};

interface ProviderSettingsProps {
  onComplete?: () => void;
  isModal?: boolean;
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ onComplete, isModal = false }) => {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('openai');
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModels, setCustomModels] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const { loadModels } = useChatStore();

  useEffect(() => {
    setProviders(directApi.getProviders());
  }, []);

  const handleAddPreset = async () => {
    const preset = PRESETS[selectedPreset];
    if (!preset) return;

    const apiKey = prompt(`Enter your ${preset.name} API key:`);
    if (!apiKey) return;

    setIsAdding(true);
    try {
      directApi.addProvider({
        name: preset.name,
        type: selectedPreset === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl: preset.baseUrl,
        apiKey,
        models: preset.models,
      });
      setProviders(directApi.getProviders());
      await loadModels();
      toast.success(`${preset.name} added successfully`);
    } catch (error) {
      toast.error('Failed to add provider');
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddCustom = async () => {
    if (!customName || !customBaseUrl || !customApiKey) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsAdding(true);
    try {
      const models = customModels.split(',').map(m => m.trim()).filter(Boolean);
      directApi.addProvider({
        name: customName,
        type: 'custom',
        baseUrl: customBaseUrl,
        apiKey: customApiKey,
        models: models.length > 0 ? models : ['default'],
      });
      setProviders(directApi.getProviders());
      await loadModels();
      setCustomName('');
      setCustomBaseUrl('');
      setCustomApiKey('');
      setCustomModels('');
      toast.success('Provider added successfully');
    } catch (error) {
      toast.error('Failed to add provider');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this provider?')) return;
    directApi.deleteProvider(id);
    setProviders(directApi.getProviders());
    await loadModels();
    toast.success('Provider removed');
  };

  const handleSetActive = async (id: string) => {
    directApi.setActiveProvider(id);
    await loadModels();
    toast.success('Active provider updated');
  };

  const content = (
    <div className="space-y-6">
      {/* Existing Providers */}
      {providers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-dark-700 mb-3">
            Configured Providers
          </h3>
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-dark-300 bg-white dark:bg-dark-200"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${directApi.getActiveProvider()?.id === provider.id ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <div>
                    <div className="font-medium text-sm">{provider.name}</div>
                    <div className="text-xs text-gray-500">{provider.models.length} models</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {directApi.getActiveProvider()?.id !== provider.id && (
                    <button
                      onClick={() => handleSetActive(provider.id)}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(provider.id)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Add Presets */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-dark-700 mb-3">
          Quick Add
        </h3>
        <div className="flex gap-2">
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-dark-300 rounded-lg bg-white dark:bg-dark-200"
          >
            {Object.entries(PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>{preset.name}</option>
            ))}
          </select>
          <button
            onClick={handleAddPreset}
            disabled={isAdding}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Custom Provider */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-dark-700 mb-3">
          Custom Provider (OpenAI-compatible)
        </h3>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Provider name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-dark-300 rounded-lg bg-white dark:bg-dark-200"
          />
          <input
            type="text"
            placeholder="Base URL (e.g., https://api.example.com)"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-dark-300 rounded-lg bg-white dark:bg-dark-200"
          />
          <input
            type="password"
            placeholder="API Key"
            value={customApiKey}
            onChange={(e) => setCustomApiKey(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-dark-300 rounded-lg bg-white dark:bg-dark-200"
          />
          <input
            type="text"
            placeholder="Models (comma-separated, e.g., gpt-4o,claude-3-opus)"
            value={customModels}
            onChange={(e) => setCustomModels(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-dark-300 rounded-lg bg-white dark:bg-dark-200"
          />
          <button
            onClick={handleAddCustom}
            disabled={isAdding || !customName || !customBaseUrl || !customApiKey}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            Add Custom Provider
          </button>
        </div>
      </div>

      {/* Continue button */}
      {providers.length > 0 && onComplete && (
        <button
          onClick={onComplete}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
        >
          Continue to Chat
        </button>
      )}
    </div>
  );

  if (isModal) {
    return content;
  }

  // Full-page setup screen
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <LogoMark size="lg" className="mx-auto mb-4 text-gray-900 dark:text-white" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Welcome to Libre WebUI
          </h1>
          <p className="mt-2 text-gray-600 dark:text-dark-600">
            Add an AI provider to get started. Your API key stays in your browser.
          </p>
        </div>
        <div className="bg-white dark:bg-dark-100 rounded-2xl shadow-xl p-6">
          {content}
        </div>
      </div>
    </div>
  );
};
