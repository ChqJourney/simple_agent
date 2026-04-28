import { ReferenceLibraryRoot } from '../types';
import {
  backendReferenceIndexBuildProgressUrl,
  backendReferenceIndexBuildUrl,
  backendReferenceIndexStatusUrl,
} from './backendEndpoint';
import { fetchWithBackendAuth } from './backendRequest';

export type ReferenceIndexStatusState = 'missing_root' | 'ready' | 'stale';
export type ReferenceIndexBuildMode = 'incremental' | 'rebuild';

export interface ReferenceIndexCounts {
  created?: number;
  updated?: number;
  removed?: number;
  unchanged?: number;
}

export interface ReferenceIndexPendingCounts {
  new: number;
  updated: number;
  removed: number;
  unchanged: number;
}

export interface ReferenceIndexStatus {
  root_id: string;
  root_path: string;
  catalog_path: string;
  exists: boolean;
  status: ReferenceIndexStatusState;
  document_count: number;
  indexed_document_count: number;
  pending: ReferenceIndexPendingCounts;
  last_built_at: string | null;
}

export interface ReferenceIndexBuildResult {
  root_id: string;
  root_path: string;
  catalog_path: string;
  generated_at: string;
  document_count: number;
  indexed_document_count: number;
  counts: Required<ReferenceIndexCounts>;
  status: 'ready';
}

export type ReferenceIndexBuildTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ReferenceIndexBuildProgress {
  build_id: string;
  root_id: string;
  root_path: string;
  mode: ReferenceIndexBuildMode;
  status: ReferenceIndexBuildTaskStatus;
  phase: string;
  progress_percent: number;
  detail: string;
  total_documents: number;
  processed_documents: number;
  counts: Required<ReferenceIndexCounts>;
  current_document?: {
    relative_path?: string;
    file_name?: string;
  } | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  result?: ReferenceIndexBuildResult;
  index_status?: ReferenceIndexStatus;
  error?: string | null;
}

interface ReferenceIndexStatusResponse {
  ok?: boolean;
  error?: string;
  status?: ReferenceIndexStatus;
}

interface ReferenceIndexBuildResponse {
  ok?: boolean;
  error?: string;
  progress?: ReferenceIndexBuildProgress;
}

interface ReferenceIndexBuildProgressResponse {
  ok?: boolean;
  error?: string;
  progress?: ReferenceIndexBuildProgress;
}

function buildRootPayload(root: Pick<ReferenceLibraryRoot, 'id' | 'path'>): Record<string, string> {
  return {
    root_id: root.id,
    root_path: root.path,
  };
}

export async function fetchReferenceIndexStatus(
  root: Pick<ReferenceLibraryRoot, 'id' | 'path'>
): Promise<ReferenceIndexStatus> {
  const response = await fetchWithBackendAuth(backendReferenceIndexStatusUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRootPayload(root)),
  });

  const payload = await response.json().catch(() => ({})) as ReferenceIndexStatusResponse;
  if (!response.ok || !payload.ok || !payload.status) {
    throw new Error(payload.error || `Failed to load reference index status (HTTP ${response.status})`);
  }
  return payload.status;
}

export async function startReferenceIndexBuild(
  root: Pick<ReferenceLibraryRoot, 'id' | 'path'>,
  mode: ReferenceIndexBuildMode = 'incremental'
): Promise<ReferenceIndexBuildProgress> {
  const response = await fetchWithBackendAuth(backendReferenceIndexBuildUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...buildRootPayload(root),
      mode,
    }),
  });

  const payload = await response.json().catch(() => ({})) as ReferenceIndexBuildResponse;
  if (!response.ok || !payload.ok || !payload.progress) {
    throw new Error(payload.error || `Failed to build reference index (HTTP ${response.status})`);
  }
  return payload.progress;
}

export async function fetchReferenceIndexBuildProgress(buildId: string): Promise<ReferenceIndexBuildProgress> {
  const response = await fetchWithBackendAuth(backendReferenceIndexBuildProgressUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ build_id: buildId }),
  });

  const payload = await response.json().catch(() => ({})) as ReferenceIndexBuildProgressResponse;
  if (!response.ok || !payload.ok || !payload.progress) {
    throw new Error(payload.error || `Failed to load reference index build progress (HTTP ${response.status})`);
  }
  return payload.progress;
}
