export type FileIconKind =
  | 'folder'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'image'
  | 'style'
  | 'html'
  | 'config'
  | 'text'
  | 'generic';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
  '.tif',
  '.tiff',
]);

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx']);
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const CONFIG_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.env',
  '.lock',
]);
const TEXT_EXTENSIONS = new Set(['.txt', '.log']);

export function getPathExtension(path: string): string {
  const baseName = path.split(/[\\/]/).pop() || path;
  const extensionIndex = baseName.lastIndexOf('.');
  return extensionIndex >= 0 ? baseName.slice(extensionIndex).toLowerCase() : '';
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getPathExtension(path));
}

export function getFileIconKind(path: string, isDirectory: boolean): FileIconKind {
  if (isDirectory) {
    return 'folder';
  }

  const extension = getPathExtension(path);

  if (TYPESCRIPT_EXTENSIONS.has(extension)) {
    return 'typescript';
  }
  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    return 'javascript';
  }
  if (extension === '.json') {
    return 'json';
  }
  if (extension === '.md' || extension === '.mdx') {
    return 'markdown';
  }
  if (isImagePath(path)) {
    return 'image';
  }
  if (STYLE_EXTENSIONS.has(extension)) {
    return 'style';
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }
  if (CONFIG_EXTENSIONS.has(extension)) {
    return 'config';
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  return 'generic';
}
