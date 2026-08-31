import { describe, expect, it } from 'vitest';
import { buildAgentWorkflow } from '../agent-workflow';

const CONFIG = {
  webhookSecret: 'secret',
  openaiApiKey: 'x',
  kintoneBaseUrl: 'https://example.cybozu.com',
  accountAppId: 1,
  accountApiToken: 'x',
  opportunityAppId: 2,
  opportunityApiToken: 'x',
  leadAppId: 3,
  leadApiToken: 'x',
  dailyAdviceAppId: 4,
  dailyAdviceApiToken: 'x',
  salesScoreAppId: 5,
  salesScoreApiToken: 'x',
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'x',
  tavilyApiKey: 'x',
  pineconeHost: 'example.pinecone.io',
  pineconeApiKey: 'x',
};

interface WorkflowNodeLike {
  name: string;
  parameters?: { jsCode?: string };
}

function jsCodeOf(nodes: unknown[], name: string): string {
  const node = (nodes as WorkflowNodeLike[]).find((n) => n.name === name);
  const jsCode = node?.parameters?.jsCode;
  if (!jsCode) throw new Error(`node "${name}" has no jsCode`);
  return jsCode;
}

// jsCode の中身はそれ自体が `return [...]` で終わる関数本体なので、new Function の
// ボディとしてそのまま渡すだけで実行できる(n8nのCode nodeの実行モデルと同じ)。
function runNode<T = Record<string, unknown>>(jsCode: string, context: Record<string, unknown>): { json: T } {
  const argNames = Object.keys(context);
  const argValues = Object.values(context);
  const fn = new Function(...argNames, jsCode) as (...args: unknown[]) => [{ json: T }];
  return fn(...argValues)[0];
}

describe('buildAgentWorkflow — generated Code node syntax', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const codeNodeNames = (wf.nodes as WorkflowNodeLike[])
    .filter((n) => !!n.parameters?.jsCode)
    .map((n) => n.name);

  it.each(codeNodeNames)('%s has syntactically valid jsCode', (name) => {
    expect(() => new Function(jsCodeOf(wf.nodes, name))).not.toThrow();
  });

  it('every connection references a node that actually exists', () => {
    const names = new Set((wf.nodes as WorkflowNodeLike[]).map((n) => n.name));
    for (const [from, conn] of Object.entries(wf.connections)) {
      expect(names.has(from)).toBe(true);
      for (const branch of (conn as { main: Array<Array<{ node: string }>> }).main) {
        for (const target of branch) {
          expect(names.has(target.node)).toBe(true);
        }
      }
    }
  });
});

interface BiPlanOutput {
  biPlan: {
    isBiQuestion: boolean;
    template?: string | null;
    metric?: string;
    dimension?: string;
    dimensionB?: string;
    period?: string;
    filters?: unknown[];
    needClarify?: string | null;
  };
}

describe('Parse BI Plan node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Parse BI Plan');

  function run(routerOutput: unknown, body: Record<string, unknown> = { message: '今期の受注額は?' }) {
    // n8n の $node は `$node["ノード名"]` で直接プロパティアクセスするオブジェクト
    // (関数呼び出しではない)——実際のCode nodeの実行モデルに合わせる。
    const $node = { 'Verify Secret': { json: { body } } };
    const $json = { choices: [{ message: { content: JSON.stringify(routerOutput) } }] };
    return runNode<BiPlanOutput>(jsCode, { $node, $json }).json;
  }

  it('accepts a valid T1 plan and normalizes defaults', () => {
    const out = run({ template: 'T1', metric: 'won_amount', filters: [] });
    expect(out.biPlan).toEqual({
      isBiQuestion: true,
      template: 'T1',
      metric: 'won_amount',
      dimension: undefined,
      dimensionB: undefined,
      period: 'current_fiscal_year',
      filters: [],
      needClarify: null,
    });
  });

  it('accepts a T8 plan with no metric (regression: T8 must not require metric)', () => {
    const out = run({ template: 'T8', filters: [{ field: 'close_date', op: '=', value: '2026-08-01' }] });
    expect(out.biPlan.isBiQuestion).toBe(true);
    expect(out.biPlan.template).toBe('T8');
    expect(out.biPlan.needClarify).toBeNull();
  });

  it('rejects a T2 plan missing a dimension deterministically (not relying on the LLM)', () => {
    const out = run({ template: 'T2', metric: 'count' });
    expect(out.biPlan.isBiQuestion).toBe(true);
    expect(out.biPlan.template).toBeNull();
    expect(out.biPlan.needClarify).toMatch(/軸/);
  });

  it('rejects an amount metric combined with a lead-only dimension', () => {
    const out = run({ template: 'T2', metric: 'amount_sum', dimension: 'lead_source' });
    expect(out.biPlan.needClarify).toMatch(/件数のみ/);
  });

  it('marks a non-BI question as such (template null, no needClarify)', () => {
    const out = run({ template: null, needClarify: null });
    expect(out.biPlan).toEqual({ isBiQuestion: false });
  });

  it('falls back safely when the LLM response is not valid JSON', () => {
    const $node = { 'Verify Secret': { json: { body: { message: 'x' } } } };
    const $json = { choices: [{ message: { content: 'not json' } }] };
    const out = runNode<BiPlanOutput>(jsCode, { $node, $json }).json;
    expect(out.biPlan).toEqual({ isBiQuestion: false });
  });
});

interface BiAggregateOutput {
  biResult?: {
    template: string;
    title: string;
    interpretation: string;
    filtersApplied: { label: string; value: string }[];
    data: {
      value?: number;
      series?: { key: string; value: number }[];
      rows?: { code: string; label: string };
      cols?: { code: string; label: string };
      matrix?: { row: string; col: string; value: number }[];
    };
    narrative: string;
  };
  factSheet?: string;
  biAggregateError?: string;
}

describe('Aggregate BI node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Aggregate BI');

  function run(biPlan: Record<string, unknown>, opportunityRecords: unknown[], leadRecords: unknown[] = []) {
    const $node = {
      'Parse BI Plan': { json: { biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' } },
      'Fetch BI Opportunities': { json: { records: opportunityRecords } },
      'Fetch BI Leads': { json: { records: leadRecords } },
    };
    return runNode<BiAggregateOutput>(jsCode, { $node }).json;
  }

  const OPPS = [
    {
      stage: { value: '成約' },
      amount: { value: '1000000' },
      owner: { value: '佐藤' },
      close_date: { value: '2026-05-01' },
    },
    {
      stage: { value: '失注' },
      amount: { value: '500000' },
      owner: { value: '鈴木' },
      loss_reason: { value: '価格' },
      industry: { value: '製造' },
      close_date: { value: '2026-05-02' },
    },
  ];

  it('produces a T1 biResult with a deterministic interpretation and no error', () => {
    const out = run({ template: 'T1', metric: 'won_amount', period: 'all', filters: [] }, OPPS);
    expect(out.biAggregateError).toBeUndefined();
    expect(out.biResult!.template).toBe('T1');
    expect(out.biResult!.data.value).toBe(1_000_000);
    expect(out.biResult!.interpretation).toContain('受注額');
  });

  it('resolves period: all with no close_date filter, keeping every record', () => {
    const out = run({ template: 'T1', metric: 'count', period: 'all', filters: [] }, OPPS);
    expect(out.biResult!.data.value).toBe(2);
  });

  it('regression: the narrative LLM is never handed a raw yen figure to convert itself — factSheet is pre-formatted in 万円 (this exact bug shipped once: "815万円" was narrated as "8,150万円")', () => {
    const out = run({ template: 'T1', metric: 'won_amount', period: 'all', filters: [] }, OPPS);
    expect(out.biResult!.data.value).toBe(1_000_000); // raw yen, correct for the chart
    expect(out.factSheet).toContain('約100万円'); // 1,000,000円 = 100万円, not 10,000万円
    expect(out.factSheet).not.toMatch(/1,000,000|1000000/); // the raw yen figure itself must never leak into the LLM-facing text
  });

  it('regression: win_rate is scaled to a 0-100 percentage before being handed to the chart/narrative (computeMetric itself returns a 0-1 fraction)', () => {
    const out = run({ template: 'T1', metric: 'win_rate', period: 'all', filters: [] }, OPPS);
    // 1 won + 1 lost in the fixture -> win_rate = 0.5 internally, must display as 50, not 0.5
    expect(out.biResult!.data.value).toBe(50);
    expect(out.factSheet).toContain('50.0%');
  });

  it('scales win_rate consistently in T2 series values too', () => {
    const out = run({ template: 'T2', metric: 'win_rate', dimension: 'owner', period: 'all', filters: [] }, OPPS);
    const series = out.biResult!.data.series!;
    // 佐藤 has one won deal only (100%), 鈴木 has one lost deal only (0%) — neither should be 1/0.
    expect(series.find((s) => s.key === '佐藤')?.value).toBe(100);
    expect(series.find((s) => s.key === '鈴木')?.value).toBe(0);
  });

  it('resolves a current_fiscal_year period into a concrete date-range filter label', () => {
    const out = run({ template: 'T1', metric: 'count', period: 'current_fiscal_year', filters: [] }, OPPS);
    expect(out.biResult!.filtersApplied[0].label).toBe('期間');
    expect(out.biResult!.filtersApplied[0].value).toMatch(/^今期\(\d{4}-\d{2}-\d{2}〜\d{4}-\d{2}-\d{2}\)$/);
  });

  it('builds a T8 record list without a metric, and never renders "null" in the interpretation (regression)', () => {
    const out = run({ template: 'T8', metric: null, period: 'all', filters: [] }, OPPS);
    expect(out.biAggregateError).toBeUndefined();
    expect(out.biResult!.template).toBe('T8');
    expect(out.biResult!.title).toBe('条件に合う案件一覧');
    expect(out.biResult!.interpretation).not.toContain('null');
    expect(out.biResult!.interpretation).not.toContain('undefined');
  });

  it('builds a T5 cross-tab payload matching the PayloadFor<"T5"> shape (rows/cols as DimView)', () => {
    const out = run(
      {
        template: 'T5',
        metric: 'count',
        dimension: 'loss_reason',
        dimensionB: 'industry',
        period: 'all',
        filters: [{ field: 'stage', op: '=', value: '失注' }],
      },
      OPPS,
    );
    expect(out.biResult!.data.rows).toEqual({ code: 'loss_reason', label: '失注理由' });
    expect(out.biResult!.data.cols).toEqual({ code: 'industry', label: '業種' });
    const cell = out.biResult!.data.matrix!.find((m) => m.row === '価格' && m.col === '製造');
    expect(cell!.value).toBe(1);
  });

  it('surfaces a structured error instead of throwing on an invalid plan', () => {
    const out = run({ template: 'T2', metric: 'amount_sum', dimension: 'lead_source', period: 'all', filters: [] }, OPPS);
    expect(out.biResult).toBeUndefined();
    expect(out.biAggregateError).toMatch(/件数のみ/);
  });
});
