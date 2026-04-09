import React from 'react';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../stores/configStore';
import { useSessionStore } from '../../stores/sessionStore';

export const ModelDisplay: React.FC = () => {
  const { t } = useI18n();
  const { config } = useConfigStore();
  const { currentSessionId, sessions } = useSessionStore();

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
  };

  const activeSession = currentSessionId
    ? sessions.find((session) => session.session_id === currentSessionId)
    : undefined;
  const lockedModel = activeSession?.locked_model;
  const displayProvider = lockedModel?.provider || config.provider;
  const displayModel = lockedModel?.model || config.model;
  const title = lockedModel
    ? t('workspace.topbar.modelLockedTitle', {
        provider: displayProvider,
        model: displayModel,
      })
    : t('workspace.topbar.modelConfiguredTitle', {
        provider: providerLabel[displayProvider] || displayProvider,
        model: displayModel,
      });

  return (
    <div className="flex items-center gap-2 text-sm" title={title}>
      <span className="font-medium text-gray-900 dark:text-white">
        {displayModel}
      </span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500 dark:text-gray-400">
        {providerLabel[displayProvider] || displayProvider}
      </span>
      {lockedModel && (
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
          {t('workspace.topbar.modelLockedBadge')}
        </span>
      )}
    </div>
  );
};
