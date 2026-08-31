import { describe, expect, it } from 'vitest';
import { buildSyncWorkflow } from '../sync-workflow';

const CONFIG = {
  openaiApiKey: 'x',
  pineconeApiKey: 'x',
  pineconeHost: 'example.pinecone.io',
  pineconeNamespace: 'exhibition-kintone',
  accountAppId: 1,
  opportunityAppId: 2,
  leadAppId: 3,
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'x',
};

interface WorkflowNodeLike {
  name: string;
  parameters?: { jsCode?: string };
}

describe('buildSyncWorkflow — generated graph', () => {
  const wf = buildSyncWorkflow(CONFIG);
  const nodes = wf.nodes as WorkflowNodeLike[];
  const codeNodeNames = nodes.filter((n) => !!n.parameters?.jsCode).map((n) => n.name);

  it.each(codeNodeNames)('%s has syntactically valid jsCode', (name) => {
    const node = nodes.find((n) => n.name === name)!;
    expect(() => new Function(node.parameters!.jsCode!)).not.toThrow();
  });

  it('every connection references a node that actually exists', () => {
    const names = new Set(nodes.map((n) => n.name));
    for (const [from, conn] of Object.entries(wf.connections)) {
      expect(names.has(from)).toBe(true);
      for (const branch of (conn as { main: Array<Array<{ node: string }>> }).main) {
        for (const target of branch) {
          expect(names.has(target.node)).toBe(true);
        }
      }
    }
  });

  it('fans out from Parse Webhook Payload to both Record to Text and Invalidate Dataset Cache (§7 — independent of the Pinecone sync branch)', () => {
    const targets = wf.connections['Parse Webhook Payload'].main[0].map((t) => t.node);
    expect(targets).toEqual(expect.arrayContaining(['Record to Text', 'Invalidate Dataset Cache']));
  });

  it('Invalidate Dataset Cache targets the dataset_cache table for both cache keys, scoped to this Supabase project', () => {
    const node = nodes.find((n) => n.name === 'Invalidate Dataset Cache') as unknown as {
      parameters: { method: string; url: string; queryParameters: { parameters: { name: string; value: string }[] } };
    };
    expect(node.parameters.method).toBe('DELETE');
    expect(node.parameters.url).toBe('https://example.supabase.co/rest/v1/dataset_cache');
    const cacheKeyParam = node.parameters.queryParameters.parameters.find((p) => p.name === 'cache_key');
    expect(cacheKeyParam?.value).toBe('in.(opportunity_records,lead_records)');
  });
});
