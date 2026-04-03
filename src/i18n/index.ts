import { useUIStore } from '../stores/uiStore';
import { enUSMessages } from './messages/en-US';
import { zhCNMessages } from './messages/zh-CN';
import { AppLocale } from './locale';

type TranslationMessages = typeof enUSMessages;
type TranslationKey = keyof TranslationMessages | string;
type TranslationParams = Record<string, string | number>;

const MESSAGES: Record<AppLocale, Record<string, string>> = {
  'en-US': enUSMessages,
  'zh-CN': zhCNMessages,
};

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function translate(locale: AppLocale, key: TranslationKey, params?: TranslationParams): string {
  const localizedMessages = MESSAGES[locale] as Record<string, string>;
  const defaultMessages = enUSMessages as Record<string, string>;
  const template = localizedMessages[key] ?? defaultMessages[key] ?? key;
  return interpolate(template, params);
}

export function getCurrentLocale(): AppLocale {
  return useUIStore.getState().locale;
}

export function formatDateTime(value: string | number | Date, locale: AppLocale = getCurrentLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatTime(value: string | number | Date, locale: AppLocale = getCurrentLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function useI18n() {
  const locale = useUIStore((state) => state.locale);
  const setLocale = useUIStore((state) => state.setLocale);

  return {
    locale,
    setLocale,
    t: (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    formatDateTime: (value: string | number | Date) => formatDateTime(value, locale),
    formatTime: (value: string | number | Date) => formatTime(value, locale),
  };
}

export type { TranslationKey, TranslationParams };
export { SUPPORTED_LOCALES, resolveAppLocale } from './locale';
export type { AppLocale } from './locale';
