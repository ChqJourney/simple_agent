import { invoke } from '@tauri-apps/api/core';

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
}

export interface SkillCatalog {
  rootPath: string;
  skills: SkillEntry[];
}

interface SkillCatalogPayload {
  root_path: string;
  skills: SkillEntry[];
}

function normalizeCatalog(payload: SkillCatalogPayload): SkillCatalog {
  return {
    rootPath: payload.root_path,
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
