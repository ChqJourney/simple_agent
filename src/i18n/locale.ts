export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function resolveAppLocale(value?: string | null): AppLocale {
  if (!value) {
    return 'en-US';
  }

  return value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}
