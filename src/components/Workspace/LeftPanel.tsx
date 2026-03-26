import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from '../../stores';
import { SessionList } from '../Sidebar/SessionList';
import { listSystemSkills, listWorkspaceSkills, SkillEntry } from '../../utils/systemSkills';

export const LeftPanel: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [systemSkills, setSystemSkills] = useState<SkillEntry[]>([]);
  const [workspaceSkills, setWorkspaceSkills] = useState<SkillEntry[]>([]);
  const [isSkillsModalOpen, setIsSkillsModalOpen] = useState(false);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const workspacePath = currentWorkspace?.path || '';
  const folderName = currentWorkspace
    ? (currentWorkspace.name || currentWorkspace.path.split(/[\\/]/).filter(Boolean).pop() || currentWorkspace.path)
    : '';

  useEffect(() => {
    let cancelled = false;

    const loadSkills = async () => {
      if (!workspacePath) {
        setSystemSkills([]);
        setWorkspaceSkills([]);
        setSkillsError(null);
        setIsLoadingSkills(false);
        return;
      }

      setIsLoadingSkills(true);
      setSkillsError(null);

      try {
        const [systemCatalog, workspaceCatalog] = await Promise.all([
          listSystemSkills(),
          listWorkspaceSkills(workspacePath),
        ]);

        if (!cancelled) {
          setSystemSkills(systemCatalog.skills);
          setWorkspaceSkills(workspaceCatalog.skills);
        }
      } catch (error) {
        if (!cancelled) {
          setSystemSkills([]);
          setWorkspaceSkills([]);
          setSkillsError(error instanceof Error ? error.message : 'Failed to scan skills.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSkills(false);
        }
      }
    };

    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  if (!currentWorkspace) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No workspace selected
      </div>
    );
  }

  const handleOpenWorkspace = async () => {
    if (isOpeningWorkspace) {
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

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200/70 p-4 dark:border-gray-800/80">
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-gray-900 dark:text-white">
              {`Workspace - ${folderName}`}
            </div>
            <button
              type="button"
              onClick={() => void handleOpenWorkspace()}
              disabled={isOpeningWorkspace}
              aria-label="Open workspace folder"
              title="Open workspace folder"
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 5.75H4.5A1.75 1.75 0 002.75 7.5v8A1.75 1.75 0 004.5 17.25h8A1.75 1.75 0 0014.25 15V12.75" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 4.25h5.75V10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 11.75L15.5 4.5" />
              </svg>
            </button>
          </div>
          <div className="text-gray-600 my-4 dark:text-gray-400" title={currentWorkspace.path}>
            <span className="block truncate whitespace-normal">{currentWorkspace.path}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSkillsModalOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/70 dark:hover:bg-gray-800"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                Skills
              </div>
              <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                {isLoadingSkills
                  ? 'Scanning...'
                  : `System ${systemSkills.length} · Workspace ${workspaceSkills.length}`}
              </div>
            </div>
            <svg className="h-4 w-4 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 5l5 5-5 5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-2 pt-2 pb-2">
        <SessionList workspacePath={currentWorkspace.path} />
      </div>

      {isSkillsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
          onClick={() => setIsSkillsModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Workspace skills"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Skills</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  System {systemSkills.length} · Workspace {workspaceSkills.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSkillsModalOpen(false)}
                className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="Close skills modal"
                title="Close skills modal"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {skillsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  {skillsError}
                </div>
              ) : (
                <div className="space-y-6">
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        System Skills
                      </h3>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {systemSkills.length}
                      </span>
                    </div>
                    {systemSkills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No system-level skills found.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {systemSkills.map((skill) => (
                          <div key={skill.path} className="rounded-2xl border border-gray-200 px-4 py-4 dark:border-gray-800">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{skill.name}</div>
                            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                              {skill.description || 'No description found in frontmatter.'}
                            </div>
                            <div className="mt-2 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                              {skill.path}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        Workspace Skills
                      </h3>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {workspaceSkills.length}
                      </span>
                    </div>
                    {workspaceSkills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No workspace-level skills found under `.agent/skills`.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {workspaceSkills.map((skill) => (
                          <div key={skill.path} className="rounded-2xl border border-gray-200 px-4 py-4 dark:border-gray-800">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{skill.name}</div>
                            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                              {skill.description || 'No description found in frontmatter.'}
                            </div>
                            <div className="mt-2 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                              {skill.path}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
