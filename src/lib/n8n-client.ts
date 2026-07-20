export interface N8nConfig {
  instanceUrl: string;
  apiKey: string;
}

export interface N8nWorkflowPayload {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
}

interface N8nListResponse {
  data: Array<{ id: string; name: string; active: boolean }>;
  nextCursor?: string | null;
}

export class N8nClient {
  private readonly instanceUrl: string;
  private readonly apiKey: string;

  constructor(config: N8nConfig) {
    this.instanceUrl = config.instanceUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.instanceUrl}/api/v1${apiPath}`, {
      method,
      headers: {
        'X-N8N-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new Error(
        `n8n API ${method} ${apiPath} failed: ${res.status} ${res.statusText} - ${text}`,
      );
    }

    return parsed as T;
  }

  /** Paginates via nextCursor, unlike a bare ?limit=100 call, since the shared instance accumulates workflows across projects. */
  async listWorkflows(): Promise<N8nWorkflowSummary[]> {
    const all: N8nWorkflowSummary[] = [];
    let cursor: string | undefined;

    do {
      const query = cursor
        ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
        : '?limit=100';
      const { data, nextCursor } = await this.request<N8nListResponse>(
        'GET',
        `/workflows${query}`,
      );
      all.push(...data.map((w) => ({ id: w.id, name: w.name, active: w.active })));
      cursor = nextCursor ?? undefined;
    } while (cursor);

    return all;
  }

  async getWorkflowByName(name: string): Promise<N8nWorkflowSummary | undefined> {
    const workflows = await this.listWorkflows();
    return workflows.find((w) => w.name === name);
  }

  /** PUT if a workflow with this name exists, else POST. Returns the workflow id. */
  async upsertWorkflowByName(payload: N8nWorkflowPayload): Promise<string> {
    const existing = await this.getWorkflowByName(payload.name);
    const body = {
      name: payload.name,
      nodes: payload.nodes,
      connections: payload.connections,
      settings: payload.settings ?? {},
    };

    if (existing) {
      const updated = await this.request<{ id: string }>(
        'PUT',
        `/workflows/${existing.id}`,
        body,
      );
      return updated.id;
    }

    const created = await this.request<{ id: string }>('POST', '/workflows', body);
    return created.id;
  }

  async activateWorkflow(id: string): Promise<void> {
    await this.request('POST', `/workflows/${id}/activate`);
  }

  async deactivateWorkflow(id: string): Promise<void> {
    await this.request('POST', `/workflows/${id}/deactivate`);
  }

  /** n8n's API never returns the webhook URL — it's this deterministic string. */
  buildWebhookUrl(path: string): string {
    return `${this.instanceUrl}/webhook/${path}`;
  }
}
