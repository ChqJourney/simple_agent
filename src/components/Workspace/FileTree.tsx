import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, exists, readDir } from '@tauri-apps/plugin-fs';
import { useI18n } from '../../i18n';
import { useWorkspaceStore } from '../../stores';
import { getFileIconKind, isImagePath } from '../../utils/fileTypes';
import { clearActiveDraggedFileDescriptors, setActiveDraggedFileDescriptors } from '../../utils/internalDragState';
import { OpenFolderIcon, ImportFilesIcon } from './FileTreeIcons';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

const FILE_TREE_DRAG_MIME = 'application/x-tauri-agent-file';
const FILE_TREE_IMAGE_DRAG_MIME = 'application/x-tauri-agent-image';
function sortEntries(entries: Array<{ name?: string; isDirectory?: boolean }>) {
  return entries
    .filter((entry) => entry.name && !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
}

function attachChildren(nodes: FileNode[], targetPath: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }

    if (!node.children) {
      return node;
    }

    return {
      ...node,
      children: attachChildren(node.children, targetPath, children),
    };
  });
}

function getPathBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function joinWorkspacePath(rootPath: string, name: string): string {
  return `${rootPath.replace(/[\\/]+$/, '')}/${name}`;
}

function renderFileIcon(kind: ReturnType<typeof getFileIconKind>) {
  switch (kind) {
    case 'folder':
      return (
        <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
      );
    case 'typescript':
      return (
        <svg className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h16v16H4z" rx="3" />
          <path d="M9 9h6v1.8h-2.1V16h-1.8v-5.2H9zm8.1 0c1.24 0 2.2.49 2.9 1.1l-1.1 1.4c-.52-.42-1.1-.7-1.8-.7-.74 0-1.12.28-1.12.74 0 .52.52.72 1.56 1.06 1.42.46 2.7 1.02 2.7 2.74 0 1.68-1.34 2.84-3.38 2.84-1.46 0-2.68-.54-3.58-1.42l1.12-1.46c.72.62 1.52 1 2.42 1 .8 0 1.3-.3 1.3-.82 0-.58-.44-.76-1.52-1.1-1.7-.54-2.74-1.16-2.74-2.78C13.96 10.18 15.18 9 17.1 9z" fill="white" />
        </svg>
      );
    case 'javascript':
      return (
        <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M10.2 9h1.75v5.3c0 1.96-.94 2.86-2.66 2.86-.78 0-1.5-.2-2.08-.6l.7-1.42c.34.24.7.38 1.1.38.76 0 1.2-.34 1.2-1.34zm3.76 6.18c.48.5 1.18.88 1.94.88.82 0 1.3-.34 1.3-.88 0-.56-.44-.76-1.34-1.14l-.46-.2c-1.34-.56-2.22-1.26-2.22-2.74 0-1.36 1.04-2.4 2.66-2.4 1.16 0 2 .4 2.6 1.42l-1.42.9c-.32-.56-.66-.78-1.18-.78-.54 0-.88.34-.88.78 0 .54.34.76 1.12 1.1l.46.2c1.58.68 2.46 1.38 2.46 2.94 0 1.68-1.32 2.6-3.1 2.6-1.74 0-2.86-.82-3.4-1.9z" fill="#1f2937" />
        </svg>
      );
    case 'json':
      return (
        <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5C7.5 5 7 6 7 7.5v1c0 1.1-.5 1.8-1.5 2 1 .2 1.5.9 1.5 2v1c0 1.5.5 2.5 2 2.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 5c1.5 0 2 .9 2 2.5v1c0 1.1.5 1.8 1.5 2-1 .2-1.5.9-1.5 2v1c0 1.5-.5 2.5-2 2.5" />
          <circle cx="12" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="12" cy="15" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'markdown':
      return (
        <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M7.5 15V9.2h1.5l1.9 2.38 1.9-2.38h1.5V15h-1.52v-3.18l-1.88 2.28-1.88-2.28V15zm9.6 0v-1.86h-1.34l2.04-2.76 2.04 2.76H18.5V15z" fill="white" />
        </svg>
      );
    case 'image':
      return (
        <svg className="h-4 w-4 text-fuchsia-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 16l3.2-3.2a1 1 0 011.4 0l2.3 2.3 1.4-1.4a1 1 0 011.4 0l1.7 1.7" />
        </svg>
      );
    case 'style':
      return (
        <svg className="h-4 w-4 text-pink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6c-2.2 0-4 1.8-4 4 0 1.6.9 2.8 2.3 3.5.95.48 1.2 1 1.2 1.75V17a2 2 0 104 0v-.5c0-1.1.66-1.5 1.7-2C15.9 13.7 17 12.2 17 10c0-2.2-1.8-4-4-4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6h6" />
        </svg>
      );
    case 'html':
      return (
        <svg className="h-4 w-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 8l-3 4 3 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l3 4-3 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6.5l-3 11" />
        </svg>
      );
    case 'config':
      return (
        <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5l1.2 1.9 2.2.52-.92 2.06 1.3 1.78-1.88 1.14.16 2.24-2.08-.5-1.98 1-.82-2.1-2.24-.3.8-2.1-1.18-1.9 2.06-.96L9.1 5.9l2.18.54z" />
          <circle cx="12" cy="10.5" r="2.1" />
        </svg>
      );
    case 'text':
      return (
        <svg className="h-4 w-4 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7.5h10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5h10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 15.5h6" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

export const FileTree: React.FC = () => {
  const { t } = useI18n();
  const { currentWorkspace, changedFiles, markChangedFile } = useWorkspaceStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const treeGenerationRef = useRef(0);

  const readDirectory = async (dirPath: string): Promise<FileNode[]> => {
    const entries = await readDir(dirPath);

    return sortEntries(entries).map((entry) => ({
      name: entry.name || '',
      path: `${dirPath}/${entry.name}`,
      isDirectory: Boolean(entry.isDirectory),
    }));
  };

  useEffect(() => {
    let cancelled = false;
    const generation = ++treeGenerationRef.current;

    const loadRootDirectory = async () => {
      if (!currentWorkspace?.path) {
        setTree([]);
        setExpandedPaths(new Set());
        setLoadingPaths(new Set());
        return;
      }

      setIsInitialLoading(true);
      setExpandedPaths(new Set());
      setLoadingPaths(new Set());

      try {
        const nodes = await readDirectory(currentWorkspace.path);
        if (!cancelled && treeGenerationRef.current === generation) {
          setTree(nodes);
        }
      } catch (error) {
        console.error('Failed to load directory:', error);
        if (!cancelled && treeGenerationRef.current === generation) {
          setTree([]);
        }
      } finally {
        if (!cancelled && treeGenerationRef.current === generation) {
          setIsInitialLoading(false);
        }
      }
    };

    void loadRootDirectory();

    return () => {
      cancelled = true;
      if (treeGenerationRef.current === generation) {
        treeGenerationRef.current += 1;
      }
    };
  }, [currentWorkspace?.path, refreshKey]);

  const toggleExpand = async (node: FileNode) => {
    if (!node.isDirectory) return;

    if (expandedPaths.has(node.path)) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
      return;
    }

    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add(node.path);
      return next;
    });

    if (node.children || loadingPaths.has(node.path)) {
      return;
    }

    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.add(node.path);
      return next;
    });

    try {
      const generation = treeGenerationRef.current;
      const children = await readDirectory(node.path);
      if (treeGenerationRef.current === generation) {
        setTree((prev) => attachChildren(prev, node.path, children));
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }
  };

  const handleImportFiles = async () => {
    if (!currentWorkspace?.path || isImporting) {
      return;
    }

    setImportError(null);
    setIsImporting(true);

    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: t('fileTree.importDialogTitle'),
      });

      const selectedPaths = Array.isArray(selected)
        ? selected.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : typeof selected === 'string' && selected
          ? [selected]
          : [];

      if (selectedPaths.length === 0) {
        return;
      }

      const conflicts: string[] = [];
      let copiedCount = 0;

      for (const sourcePath of selectedPaths) {
        const fileName = getPathBaseName(sourcePath);
        const targetPath = joinWorkspacePath(currentWorkspace.path, fileName);

        if (await exists(targetPath)) {
          conflicts.push(fileName);
          continue;
        }

        await copyFile(sourcePath, targetPath);
        markChangedFile(targetPath, 'created');
        copiedCount += 1;
      }

      if (copiedCount > 0) {
        setRefreshKey((value) => value + 1);
      }

      if (conflicts.length > 0) {
        setImportError(t('fileTree.importSkipped', { files: conflicts.join(', ') }));
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('fileTree.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleOpenWorkspace = async () => {
    if (!currentWorkspace?.path || isOpeningWorkspace) {
      return;
    }

    setIsOpeningWorkspace(true);
    try {
      await invoke('open_workspace_folder', { selectedPath: currentWorkspace.path });
    } catch (error) {
      console.error('Failed to open workspace folder:', error);
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isLoadingChildren = loadingPaths.has(node.path);
    const changedKind = changedFiles[node.path];
    const iconKind = getFileIconKind(node.path, node.isDirectory);
    const changeHighlightClass = changedKind === 'created'
      ? 'ring-1 ring-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 dark:ring-emerald-800'
      : changedKind === 'updated'
        ? 'ring-1 ring-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:ring-amber-800'
        : '';

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer rounded text-sm ${changeHighlightClass}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => void toggleExpand(node)}
          draggable={true}
          onDragStart={(e) => {
            const isImageFile = !node.isDirectory && isImagePath(node.path);
            setActiveDraggedFileDescriptors([
              {
                path: node.path,
                name: node.name,
                isDirectory: node.isDirectory,
                isImage: isImageFile,
              },
            ]);
            e.dataTransfer.setData('text/plain', node.path);
            e.dataTransfer.setData(
              FILE_TREE_DRAG_MIME,
              JSON.stringify({
                path: node.path,
                name: node.name,
                isDirectory: node.isDirectory,
                isImage: isImageFile,
              })
            );
            if (isImageFile) {
              e.dataTransfer.setData(FILE_TREE_IMAGE_DRAG_MIME, node.path);
            }
          }}
          onDragEnd={() => {
            clearActiveDraggedFileDescriptors();
          }}
        >
          {node.isDirectory ? (
            isLoadingChildren ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )
          ) : (
            <span className="w-4" />
          )}
          <span data-icon-kind={iconKind}>
            {renderFileIcon(iconKind)}
          </span>
          <span className="text-gray-700 dark:text-gray-300 truncate">{node.name}</span>
        </div>
        {node.isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!currentWorkspace) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        {t('fileTree.noWorkspaceSelected')}
      </div>
    );
  }

  if (isInitialLoading) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        {t('fileTree.loading')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-gray-200/80 bg-white/95 px-2 py-2 backdrop-blur dark:border-gray-800/80 dark:bg-gray-900/95">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
            {t('fileTree.files')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleOpenWorkspace()}
              disabled={!currentWorkspace?.path || isOpeningWorkspace}
              className="group relative rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              title={t('fileTree.openFolder')}
            >
              <OpenFolderIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void handleImportFiles()}
              disabled={!currentWorkspace?.path || isImporting}
              className="group relative rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              title={t('fileTree.importFiles')}
            >
              <ImportFilesIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        {importError && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
            {importError}
          </div>
        )}
      </div>
      <div className="py-2">
        {tree.map((node) => renderNode(node))}
      </div>
    </div>
  );
};
