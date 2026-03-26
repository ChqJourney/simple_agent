import { invoke } from '@tauri-apps/api/core';

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
}

export interface SkillCatalog {
  rootPath: string;
  rootPaths: string[];
  skills: SkillEntry[];
}

interface SkillCatalogPayload {
  root_path: string;
  root_paths?: string[];
  skills: SkillEntry[];
}

function normalizeCatalog(payload: SkillCatalogPayload): SkillCatalog {
  const rootPaths = payload.root_paths?.filter(Boolean) ?? (payload.root_path ? [payload.root_path] : []);
  return {
    rootPath: rootPaths[0] ?? payload.root_path ?? '',
    rootPaths,
    skills: payload.skills,
  };
}

export async function listSystemSkills(): Promise<SkillCatalog> {
  const payload = await invoke<SkillCatalogPayload>('scan_system_skills');
  return normalizeCatalog(payload);
}

export async function listWorkspaceSkills(workspacePath: string): Promise<SkillCatalog> {
  const payload = await invoke<SkillCatalogPayload>('scan_workspace_skills', { workspacePath });
  return normalizeCatalog(payload);
}
