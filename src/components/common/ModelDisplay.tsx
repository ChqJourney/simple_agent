import React from 'react';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../stores/configStore';

export const ModelDisplay: React.FC = () => {
  const { t } = useI18n();
  const { config } = useConfigStore();

  if (!config) {
    return (
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {t('model.noneSelected')}
      </span>
    );
  }

  const providerLabel: Record<string, string> = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    glm: 'GLM',
    minimax: 'MiniMax',
    qwen: 'Qwen',
    ollama: 'Ollama',
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-gray-900 dark:text-white">
        {config.model}
      </span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500 dark:text-gray-400">
        {providerLabel[config.provider] || config.provider}
      </span>
    </div>
  );
};
