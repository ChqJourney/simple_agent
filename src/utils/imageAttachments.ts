import type { Attachment } from '../types';
import { getPathExtension } from './fileTypes';

export function attachmentKey(attachment: Attachment): string {
  return `${attachment.name}:${attachment.path}`;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function guessImageMimeType(path: string): string {
  switch (getPathExtension(path)) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.png':
    default:
      return 'image/png';
  }
}

export function getAttachmentPreviewSrc(attachment: Attachment): string | null {
  return attachment.data_url || null;
}

export async function resolveAttachmentPreviewSrc(attachment: Attachment): Promise<string | null> {
  if (attachment.data_url) {
    return attachment.data_url;
  }

  if (!attachment.path) {
    return null;
  }

  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(attachment.path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mimeType = attachment.mime_type || guessImageMimeType(attachment.path);
    return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return null;
  }
}
