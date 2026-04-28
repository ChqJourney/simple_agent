import { backendToolsUrl } from './backendEndpoint';
import { fetchWithBackendAuth } from './backendRequest';

export interface ToolCatalogEntry {
  name: string;
  description: string;
}

interface ToolCatalogResponse {
  tools?: Array<{
    name?: string;
    description?: string;
  }>;
}

export async function listTools(): Promise<ToolCatalogEntry[]> {
  const response = await fetchWithBackendAuth(backendToolsUrl);

  if (response.status === 404) {
    throw new Error('Backend endpoint /tools not found. Please update backend build.');
  }

  if (!response.ok) {
    throw new Error(`Failed to load tools (HTTP ${response.status})`);
  }

  const payload = await response.json() as ToolCatalogResponse;
  const tools = Array.isArray(payload.tools) ? payload.tools : [];

  return tools
    .filter(
      (tool): tool is { name: string; description: string } =>
        typeof tool?.name === 'string'
        && tool.name.trim().length > 0
        && typeof tool.description === 'string'
    )
    .map((tool) => ({
      name: tool.name.trim(),
      description: tool.description,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
