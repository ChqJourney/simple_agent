import type { ImageSupportStatus, InputType, ProviderCatalogModel } from '../types';

export function resolveImageSupportStatus(metadata?: ProviderCatalogModel): ImageSupportStatus {
  if (metadata?.image_support) {
    return metadata.image_support;
  }
  if (typeof metadata?.supports_image_in === 'boolean') {
    return metadata.supports_image_in ? 'supported' : 'unsupported';
  }
  return 'unknown';
}

export function getDefaultInputType(metadata?: ProviderCatalogModel): InputType {
  return resolveImageSupportStatus(metadata) === 'supported' ? 'image' : 'text';
}

export function coerceInputTypeForModel(
  inputType: unknown,
  metadata?: ProviderCatalogModel
): InputType {
  const normalized = inputType === 'image' ? 'image' : 'text';
  const imageSupport = resolveImageSupportStatus(metadata);

  if (imageSupport === 'unsupported') {
    return 'text';
  }

  return normalized;
}

export function resolveConfiguredInputType(
  profile: { input_type?: unknown } | null | undefined,
  metadata?: ProviderCatalogModel
): InputType {
  if (profile?.input_type === 'image' || profile?.input_type === 'text') {
    return coerceInputTypeForModel(profile.input_type, metadata);
  }

  return getDefaultInputType(metadata);
}

export function supportsImageInputForConfiguredMode(
  inputType: InputType,
  metadata?: ProviderCatalogModel
): boolean {
  return coerceInputTypeForModel(inputType, metadata) === 'image';
}
