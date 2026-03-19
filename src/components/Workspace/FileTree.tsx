import React, { useEffect, useRef, useState } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';
import { useWorkspaceStore } from '../../stores';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

const FILE_TREE_DRAG_MIME = 'application/x-tauri-agent-file';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function isImagePath(path: string): boolean {
  const extension = path.includes('.') ? `.${path.split('.').pop()?.toLowerCase()}` : '';
  return IMAGE_EXTENSIONS.has(extension);
}

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

export const FileTree: React.FC = () => {
  const { currentWorkspace, changedFiles } = useWorkspaceStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
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
  }, [currentWorkspace?.path]);

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

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isLoadingChildren = loadingPaths.has(node.path);
    const changedKind = changedFiles[node.path];
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
            e.dataTransfer.setData('text/plain', node.path);
            e.dataTransfer.setData(
              FILE_TREE_DRAG_MIME,
              JSON.stringify({
                path: node.path,
                name: node.name,
                isDirectory: node.isDirectory,
                isImage: !node.isDirectory && isImagePath(node.path),
              })
            );
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
          {node.isDirectory ? (
            <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
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
        No workspace selected
      </div>
    );
  }

  if (isInitialLoading) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="py-2">
        {tree.map((node) => renderNode(node))}
      </div>
    </div>
  );
};
