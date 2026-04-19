import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./backendAuth', () => ({
  buildBackendAuthHeaders: (token: string) => ({ 'X-Tauri-Agent-Auth': token }),
  getBackendAuthToken: vi.fn(async () => 'test-auth-token'),
}));

describe('referenceIndex utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads reference index status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        status: {
          root_id: 'root-1',
          root_path: '/refs',
          catalog_path: '/catalog.json',
          exists: true,
          status: 'ready',
          document_count: 10,
          indexed_document_count: 10,
          pending: { new: 0, updated: 0, removed: 0, unchanged: 10 },
          last_built_at: '2026-04-18T00:00:00Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReferenceIndexStatus } = await import('./referenceIndex');
    const status = await fetchReferenceIndexStatus({ id: 'root-1', path: '/refs' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(status.status).toBe('ready');
    expect(status.document_count).toBe(10);
  });

  it('starts rebuild requests and returns initial progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        progress: {
          build_id: 'build-1',
          root_id: 'root-1',
          root_path: '/refs',
          mode: 'rebuild',
          status: 'queued',
          phase: 'queued',
          progress_percent: 0,
          detail: 'Queued standard catalog build...',
          total_documents: 0,
          processed_documents: 0,
          counts: { created: 0, updated: 0, removed: 0, unchanged: 0 },
          started_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
          completed_at: null,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { startReferenceIndexBuild } = await import('./referenceIndex');
    const payload = await startReferenceIndexBuild({ id: 'root-1', path: '/refs' }, 'rebuild');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.method).toBe('POST');
    expect(String(request?.body)).toContain('"mode":"rebuild"');
    expect(payload.build_id).toBe('build-1');
    expect(payload.status).toBe('queued');
  });

  it('loads reference index build progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        progress: {
          build_id: 'build-1',
          root_id: 'root-1',
          root_path: '/refs',
          mode: 'incremental',
          status: 'running',
          phase: 'summarizing',
          progress_percent: 50,
          detail: 'Summarizing scope and topics: IEC-60335-1.pdf',
          total_documents: 4,
          processed_documents: 2,
          counts: { created: 1, updated: 0, removed: 0, unchanged: 1 },
          started_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:05Z',
          completed_at: null,
          current_document: {
            relative_path: 'IEC-60335-1.pdf',
            file_name: 'IEC-60335-1.pdf',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchReferenceIndexBuildProgress } = await import('./referenceIndex');
    const payload = await fetchReferenceIndexBuildProgress('build-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload.phase).toBe('summarizing');
    expect(payload.progress_percent).toBe(50);
    expect(payload.current_document?.file_name).toBe('IEC-60335-1.pdf');
  });
});
