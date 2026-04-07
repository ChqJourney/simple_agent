import { RunEventRecord } from '../types';
import type { TranslationKey, TranslationParams } from '../i18n';

type Translator = (key: TranslationKey, values?: TranslationParams) => string;

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function getRunEventReason(event: RunEventRecord): string | null {
  return (
    nonEmptyString(event.payload.details)
    || nonEmptyString(event.payload.reason)
    || nonEmptyString(event.payload.error)
  );
}

export function formatRunEventDetails(event: RunEventRecord, t: Translator): string | null {
  const toolName = nonEmptyString(event.payload.tool_name);
  const attempt = typeof event.payload.attempt === 'number' ? event.payload.attempt : null;
  const hitCount = typeof event.payload.hit_count === 'number' ? event.payload.hit_count : null;
  const skillName = nonEmptyString(event.payload.skill_name);
  const strategy = nonEmptyString(event.payload.strategy);
  const task = nonEmptyString(event.payload.task);
  const workerModel = nonEmptyString(event.payload.worker_model);
  const workerProvider = nonEmptyString(event.payload.worker_provider);
  const postTokensEstimate = typeof event.payload.post_tokens_estimate === 'number'
    ? event.payload.post_tokens_estimate
    : null;
  const reason = getRunEventReason(event);
  const skillNames = Array.isArray(event.payload.skill_names)
    ? event.payload.skill_names.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : [];

  if (event.event_type.startsWith('session_compaction_')) {
    const details: string[] = [];
    if (strategy) {
      details.push(strategy);
    }
    if (postTokensEstimate !== null && event.event_type === 'session_compaction_completed') {
      details.push(t('timeline.details.tokens', { count: postTokensEstimate }));
    }
    if (reason && (event.event_type === 'session_compaction_skipped' || event.event_type === 'session_compaction_failed')) {
      details.push(reason);
    }
    return details.length > 0 ? details.join(' - ') : null;
  }

  if (event.event_type === 'delegated_task_started') {
    return task;
  }

  if (event.event_type === 'delegated_task_completed') {
    if (workerProvider && workerModel) {
      return `${workerProvider}/${workerModel}`;
    }
    return workerModel;
  }

  if (event.event_type === 'retry_scheduled') {
    const details: string[] = [];
    if (attempt !== null) {
      details.push(t('timeline.details.attempt', { count: attempt }));
    }
    if (reason) {
      details.push(reason);
    }
    return details.length > 0 ? details.join(' - ') : null;
  }

  if (event.event_type === 'run_failed' || event.event_type === 'run_max_rounds_reached') {
    return reason;
  }

  if (toolName) {
    return toolName;
  }
  if (skillName) {
    return skillName;
  }
  if (skillNames.length > 0) {
    return skillNames.join(', ');
  }
  if (attempt !== null) {
    return t('timeline.details.attempt', { count: attempt });
  }
  if (hitCount !== null) {
    return hitCount === 1 ? t('timeline.details.hitOne') : t('timeline.details.hitMany', { count: hitCount });
  }
  return null;
}
