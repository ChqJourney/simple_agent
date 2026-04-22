import { buildBackendAuthHeaders, getBackendAuthToken } from './backendAuth';
import {
  backendStandardQaReportPdfProgressUrl,
  backendStandardQaReportPdfStartUrl,
  backendStandardQaReportPdfUrl,
  backendStandardQaReportSummaryUrl,
} from './backendEndpoint';

export interface StandardQaReportSummary {
  title: string;
  overview: string;
  key_points: string[];
  evidence_highlights: string[];
  open_questions: string[];
}

export interface StandardQaReportSummaryResult {
  summary: StandardQaReportSummary;
  digest: string;
  generated_at: string;
  cached: boolean;
}

export interface StandardQaReportPdfResult {
  filename: string;
  pdf_base64: string;
  digest: string;
  generated_at: string;
  cached: boolean;
}

export type StandardQaReportGenerationStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface StandardQaReportProgress {
  report_id: string;
  session_id: string;
  workspace_path: string;
  status: StandardQaReportGenerationStatus;
  phase: string;
  progress_percent: number;
  detail: string;
  generated_characters: number;
  generated_tokens: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  filename?: string | null;
  pdf_base64?: string | null;
  digest?: string | null;
  generated_at?: string | null;
  cached: boolean;
  error?: string | null;
}

interface StandardQaReportResponse {
  ok?: boolean;
  error?: string;
  summary?: StandardQaReportSummary;
  filename?: string;
  pdf_base64?: string;
  digest?: string;
  generated_at?: string;
  cached?: boolean;
  progress?: StandardQaReportProgress;
}

async function getAuthToken(): Promise<string> {
  const authToken = await getBackendAuthToken({ isTestMode: import.meta.env.MODE === 'test' });
  if (!authToken) {
    throw new Error('Backend auth handshake failed');
  }
  return authToken;
}

function buildPayload(workspacePath: string, sessionId: string, force = false) {
  return {
    workspace_path: workspacePath,
    session_id: sessionId,
    force,
  };
}

async function postReportRequest(
  url: string,
  workspacePath: string,
  sessionId: string,
  force = false
): Promise<StandardQaReportResponse> {
  const authToken = await getAuthToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildBackendAuthHeaders(authToken),
    },
    body: JSON.stringify(buildPayload(workspacePath, sessionId, force)),
  });
  const payload = await response.json().catch(() => ({})) as StandardQaReportResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Report request failed (HTTP ${response.status})`);
  }
  return payload;
}

export async function fetchStandardQaReportSummary(
  workspacePath: string,
  sessionId: string,
  force = false
): Promise<StandardQaReportSummaryResult> {
  const payload = await postReportRequest(
    backendStandardQaReportSummaryUrl,
    workspacePath,
    sessionId,
    force
  );
  if (!payload.summary || !payload.digest || !payload.generated_at) {
    throw new Error('Report summary response is incomplete.');
  }
  return {
    summary: payload.summary,
    digest: payload.digest,
    generated_at: payload.generated_at,
    cached: Boolean(payload.cached),
  };
}

export async function generateStandardQaReportPdf(
  workspacePath: string,
  sessionId: string,
  force = false
): Promise<StandardQaReportPdfResult> {
  const payload = await postReportRequest(
    backendStandardQaReportPdfUrl,
    workspacePath,
    sessionId,
    force
  );
  if (!payload.filename || !payload.pdf_base64 || !payload.digest || !payload.generated_at) {
    throw new Error('Report PDF response is incomplete.');
  }
  return {
    filename: payload.filename,
    pdf_base64: payload.pdf_base64,
    digest: payload.digest,
    generated_at: payload.generated_at,
    cached: Boolean(payload.cached),
  };
}

export async function startStandardQaReportPdfGeneration(
  workspacePath: string,
  sessionId: string,
  force = false
): Promise<StandardQaReportProgress> {
  const payload = await postReportRequest(
    backendStandardQaReportPdfStartUrl,
    workspacePath,
    sessionId,
    force
  );
  if (!payload.progress) {
    throw new Error('Report generation start response is incomplete.');
  }
  return payload.progress;
}

export async function fetchStandardQaReportPdfProgress(reportId: string): Promise<StandardQaReportProgress> {
  const authToken = await getAuthToken();
  const response = await fetch(backendStandardQaReportPdfProgressUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildBackendAuthHeaders(authToken),
    },
    body: JSON.stringify({ report_id: reportId }),
  });

  const payload = await response.json().catch(() => ({})) as StandardQaReportResponse;
  if (!response.ok || !payload.ok || !payload.progress) {
    throw new Error(payload.error || `Report progress request failed (HTTP ${response.status})`);
  }
  return payload.progress;
}
