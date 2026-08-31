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
    op?: string;
    template?: string | null;
    metric?: string;
    dimension?: string;
    dimensionB?: string;
    period?: string;
    filters?: unknown[];
    topN?: number;
    sort?: string;
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
      op: 'query',
      template: 'T1',
      metric: 'won_amount',
      dimension: undefined,
      dimensionB: undefined,
      period: 'current_fiscal_year',
      filters: [],
      needClarify: null,
    });
  });

  it('captures topN/sort on a fresh query too, not just refine (e.g. "業種別の受注額を上位5件だけ、多い順で")', () => {
    const out = run({ template: 'T2', metric: 'amount_sum', dimension: 'industry', topN: 5, sort: 'value_desc', filters: [] });
    expect(out.biPlan.topN).toBe(5);
    expect(out.biPlan.sort).toBe('value_desc');
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

  // RELVA BI 追加要件定義書 §4: op: refine|narrate|clarify のルーター拡張。
  const currentCard = {
    template: 'T2',
    params: { metric: 'amount_sum', dimension: 'owner', period: { preset: 'current_fiscal_year' } },
    title: '担当者別 受注額',
  };

  it('op:refine merges the patch into currentCard.params via cards.ts refine(), keeping the same template', () => {
    const out = run({ op: 'refine', dimension: 'industry' }, { message: '業種で見せて', currentCard });
    expect(out.biPlan).toEqual({
      isBiQuestion: true,
      op: 'refine',
      template: 'T2', // currentCardのtemplateを維持
      metric: 'amount_sum', // 変更しなかったフィールドはcurrentCardの値を維持
      dimension: 'industry', // パッチで変更されたフィールド
      dimensionB: undefined,
      period: 'current_fiscal_year',
      filters: [],
      needClarify: null,
    });
  });

  it('op:refine changes only the period when that is all the patch specifies', () => {
    const out = run({ op: 'refine', period: 'last_month' }, { message: '先月で', currentCard });
    expect(out.biPlan.dimension).toBe('owner'); // 維持
    expect(out.biPlan.period).toBe('last_month'); // 変更
  });

  it('op:refine without a currentCard asks the user to start with a query instead', () => {
    const out = run({ op: 'refine', dimension: 'industry' }, { message: '業種で見せて', currentCard: null });
    expect(out.biPlan.op).toBe('clarify');
    expect(out.biPlan.needClarify).toMatch(/表示されているグラフが無い/);
  });

  // RELVA BI 追加要件定義書 §3-1: 「上位N件」「多い順/少ない順」のワンクリックチップ
  // (card-controls.ts)が実際にbiPlanへ反映されることの回帰テスト——一度、この2フィールドが
  // refine()を通っても最終plan構築時に落とされ、無視されるバグがあった。
  it('op:refine carries topN through into the plan (the one-click "上位N件" chip)', () => {
    const out = run({ op: 'refine', topN: 5 }, { message: '上位5件だけ見せて', currentCard });
    expect(out.biPlan.topN).toBe(5);
    expect(out.biPlan.dimension).toBe('owner'); // 維持
  });

  it('op:refine carries sort through into the plan (the one-click "少ない順" chip)', () => {
    const out = run({ op: 'refine', sort: 'value_asc' }, { message: '少ない順に並べて', currentCard });
    expect(out.biPlan.sort).toBe('value_asc');
  });

  it('op:refine ignores an invalid sort value from the router instead of leaking it through', () => {
    const out = run({ op: 'refine', sort: 'not_a_real_sort' }, { message: '変な並び順で', currentCard });
    expect(out.biPlan.sort).toBeUndefined();
  });

  it('op:refine still runs the deterministic shape validation on the merged result (e.g. T5 needs 2 dimensions)', () => {
    const t5Card = { template: 'T5', params: { metric: 'count', dimension: 'loss_reason', dimensionB: 'industry' } };
    // dimensionBをpatchで消すような入力(LLMが送ってこない想定だが、防御的に無効な形は弾く)
    const out = run({ op: 'refine', metric: 'win_rate' }, { message: '受注率で', currentCard: t5Card });
    // T5でリード専用metricの組み合わせ等、不正な形になった場合はclarifyへ落ちることを確認する
    // (ここでは有効な組み合わせなので通常どおりrefineが成立することを確認)
    expect(out.biPlan.op).toBe('refine');
    expect(out.biPlan.template).toBe('T5');
    expect(out.biPlan.metric).toBe('win_rate');
  });

  it('op:narrate carries the currentCard params through as-is (no new aggregation, just echoes what is already shown)', () => {
    const out = run({ op: 'narrate' }, { message: 'このグラフについて何が言える?', currentCard });
    expect(out.biPlan).toEqual({
      isBiQuestion: true,
      op: 'narrate',
      template: 'T2',
      metric: 'amount_sum',
      dimension: 'owner',
      dimensionB: undefined,
      period: 'current_fiscal_year',
      filters: [],
      needClarify: null,
    });
  });

  it('op:narrate without a currentCard asks the user to start with a query instead', () => {
    const out = run({ op: 'narrate' }, { message: 'これについて教えて', currentCard: null });
    expect(out.biPlan.op).toBe('clarify');
    expect(out.biPlan.needClarify).toMatch(/表示されているグラフが無い/);
  });

  it('op:clarify passes through the LLM-provided clarifying question', () => {
    const out = run({ op: 'clarify', needClarify: '期間を教えてください' }, { message: '受注率は?' });
    expect(out.biPlan).toEqual({ isBiQuestion: true, op: 'clarify', template: null, needClarify: '期間を教えてください' });
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
    // §7のデータセットキャッシュ導入後、Aggregate BIは Prepare BI Datasets(集約ノード)
    // 経由でopportunityRecords/leadRecordsを読む(キャッシュヒット/ミスのどちらが実行された
    // かに関わらず同じ名前で読めるようにする恒等ノード)。
    const $node = {
      'Parse BI Plan': { json: { biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' } },
      'Prepare BI Datasets': { json: { opportunityRecords, leadRecords } },
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

// RELVA BI 追加要件定義書 §7: query/refineのたびに毎回kintoneへ500件フェッチし直すのを避ける
// ためのデータセットキャッシュ。キャッシュヒット/ミスのどちらでも、後続のAggregate BIが読む
// Prepare BI Datasetsの形(opportunityRecords/leadRecords)へ正規化する2つのノードを検証する。
// n8nのHTTP RequestノードはPostgRESTの配列レスポンスを1件ずつ別アイテムに分割するため
// (Supabase Feedback Searchノードの既存コメントと同じ挙動)、これを1回で判定できる形に
// 戻すノード。実際にこのバグで一度、キャッシュがヒットしているのに毎回ミス判定される
// リグレッションが本番で発生した(このテストが無いと再発を検知できない)。
describe('Collect Dataset Cache Rows node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Collect Dataset Cache Rows');

  it('wraps all incoming items into a single { rows: [...] } item (json cannot be a bare array in n8n)', () => {
    const $input = { all: () => [{ json: { cache_key: 'opportunity_records' } }, { json: { cache_key: 'lead_records' } }] };
    const out = runNode<{ rows: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ rows: [{ cache_key: 'opportunity_records' }, { cache_key: 'lead_records' }] });
  });

  it('produces an empty rows array on a cold cache (0 incoming items)', () => {
    const $input = { all: () => [] };
    const out = runNode<{ rows: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ rows: [] });
  });

  it('filters out the placeholder empty item n8n forces through on a 0-row alwaysOutputData response (regression: this once made a real cache hit report length 1 instead of 0, still correctly a miss but for the wrong reason)', () => {
    const $input = { all: () => [{ json: {} }] };
    const out = runNode<{ rows: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ rows: [] });
  });
});

describe('Use Cached Datasets node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Use Cached Datasets');

  it('extracts opportunityRecords/leadRecords from the 2 cached rows, keyed by cache_key', () => {
    const $node = { 'Parse BI Plan': { json: { biPlan: { template: 'T1' }, sessionId: 's' } } };
    // Collect Dataset Cache Rows が {rows: [...]} の形に包んで渡す(n8nのCode nodeはjsonの
    // 値が直接配列だと拒否するため)。
    const $json = {
      rows: [
        { cache_key: 'opportunity_records', data: [{ deal_name: { value: 'A' } }] },
        { cache_key: 'lead_records', data: [{ lead_name: { value: 'B' } }] },
      ],
    };
    const out = runNode<{ opportunityRecords: unknown[]; leadRecords: unknown[]; sessionId: string }>(jsCode, {
      $node,
      $json,
    }).json;
    expect(out.opportunityRecords).toEqual([{ deal_name: { value: 'A' } }]);
    expect(out.leadRecords).toEqual([{ lead_name: { value: 'B' } }]);
    expect(out.sessionId).toBe('s'); // Parse BI Planの他フィールドも維持される
  });

  it('defaults to empty arrays if $json.rows is not the expected array shape (defensive)', () => {
    const $node = { 'Parse BI Plan': { json: { biPlan: {} } } };
    const out = runNode<{ opportunityRecords: unknown[]; leadRecords: unknown[] }>(jsCode, { $node, $json: {} }).json;
    expect(out.opportunityRecords).toEqual([]);
    expect(out.leadRecords).toEqual([]);
  });
});

describe('Build Fetched Datasets node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Fetched Datasets');

  it('extracts opportunityRecords/leadRecords from Fetch BI Opportunities/Leads by name', () => {
    const $node = {
      'Parse BI Plan': { json: { biPlan: { template: 'T1' }, sessionId: 's' } },
      'Fetch BI Opportunities': { json: { records: [{ deal_name: { value: 'A' } }] } },
      'Fetch BI Leads': { json: { records: [{ lead_name: { value: 'B' } }] } },
    };
    const out = runNode<{ opportunityRecords: unknown[]; leadRecords: unknown[] }>(jsCode, { $node }).json;
    expect(out.opportunityRecords).toEqual([{ deal_name: { value: 'A' } }]);
    expect(out.leadRecords).toEqual([{ lead_name: { value: 'B' } }]);
  });
});

// RELVA BI 追加要件定義書 §4: narrateは新しい集計を一切行わず、直前のカード(currentCard)の
// 確定済みデータをそのまま引き継ぐ——Fetch BI Opportunities/Leads・Aggregate BIを丸ごと
// バイパスする経路。
describe('Build Narrate Input node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Narrate Input');

  function run(biPlan: Record<string, unknown>, currentCard: Record<string, unknown> | null) {
    const $node = {
      'Parse BI Plan': { json: { biPlan, currentCard, sessionId: 's', userId: 'u', userName: 'n', message: 'm' } },
    };
    return runNode<BiAggregateOutput>(jsCode, { $node }).json;
  }

  const currentCard = {
    template: 'T2',
    params: { metric: 'amount_sum', dimension: 'owner', period: { preset: 'current_fiscal_year' } },
    title: '担当者別 受注額(今期)',
    interpretation: '担当者別の受注額合計です。',
    filtersApplied: [{ label: '期間', value: '今期(2026-04-01〜2027-03-31)' }],
    data: { metric: { code: 'amount_sum', label: '受注額合計', unit: '円' }, dimension: { code: 'owner', label: '担当者' }, series: [{ key: '飯田', value: 8_150_000 }] },
  };

  it('reuses currentCard.data verbatim as biResult without recomputing anything', () => {
    const biPlan = { template: 'T2', metric: 'amount_sum', dimension: 'owner', period: 'current_fiscal_year', filters: [] };
    const out = run(biPlan, currentCard);
    expect(out.biAggregateError).toBeUndefined();
    expect(out.biResult).toEqual({
      template: 'T2',
      title: '担当者別 受注額(今期)',
      interpretation: '担当者別の受注額合計です。',
      filtersApplied: currentCard.filtersApplied,
      data: currentCard.data,
      narrative: '',
    });
  });

  it('formats factSheet with the same buildFactSheet() used by Aggregate BI (万円換算, no raw yen leak)', () => {
    const biPlan = { template: 'T2', metric: 'amount_sum', dimension: 'owner', period: 'current_fiscal_year', filters: [] };
    const out = run(biPlan, currentCard);
    expect(out.factSheet).toContain('815万円');
    expect(out.factSheet).not.toMatch(/8,150,000|8150000/);
  });

  it('defensively surfaces a structured error when currentCard has no data (should not normally happen — Parse BI Plan already checked template presence)', () => {
    const biPlan = { template: 'T2', metric: 'amount_sum', dimension: 'owner', period: 'current_fiscal_year', filters: [] };
    const out = run(biPlan, { template: 'T2', params: {}, title: 't' });
    expect(out.biResult).toBeUndefined();
    expect(out.biAggregateError).toMatch(/見つかりませんでした/);
  });
});

// RELVA BI 追加要件定義書 §3: カード=テンプレインスタンス統一モデル。Format BI Responseは
// query/refine/narrateのどれが実行されても、同じ形のcardSpecをフロントエンドへ返す必要がある
// (フロントエンドはこれをcurrentCardとして保持し、次のリクエストに載せて送り返す)。
describe('Format BI Response node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Format BI Response');

  interface FormatBiResponseOutput {
    response: {
      answer: string;
      biResult: { template: string; title: string };
      cardSpec: {
        template: string;
        params: { metric?: string; dimension?: string; dimensionB?: string; filters: unknown[]; period?: { preset: string } };
        title: string;
        interpretation: string;
        filtersApplied: unknown[];
        data: unknown;
      };
    };
  }

  function run(prepareOutput: Record<string, unknown>, narrativeContent: string) {
    const $node = { 'Prepare BI Narrative Input': { json: prepareOutput } };
    const $json = { choices: [{ message: { content: narrativeContent } }] };
    return runNode<FormatBiResponseOutput>(jsCode, { $node, $json }).json;
  }

  const biResult = {
    template: 'T2',
    title: '担当者別 受注額(今期)',
    interpretation: '担当者別の受注額合計です。',
    filtersApplied: [{ label: '期間', value: '今期(2026-04-01〜2027-03-31)' }],
    data: { series: [{ key: '飯田', value: 8_150_000 }] },
  };
  const biPlan = { template: 'T2', metric: 'amount_sum', dimension: 'owner', dimensionB: undefined, period: 'current_fiscal_year', filters: [] };

  it('builds a cardSpec whose params mirror biPlan, regardless of whether query/refine/narrate produced it', () => {
    const out = run({ biResult, biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, JSON.stringify({ narrative: '飯田さんが最も多く受注しています。' }));
    expect(out.response.cardSpec).toEqual({
      template: 'T2',
      params: { metric: 'amount_sum', dimension: 'owner', dimensionB: undefined, filters: [], period: { preset: 'current_fiscal_year' } },
      title: biResult.title,
      interpretation: biResult.interpretation,
      filtersApplied: biResult.filtersApplied,
      data: biResult.data,
    });
  });

  it('falls back to the interpretation as the narrative when the LLM response is not valid JSON', () => {
    const out = run({ biResult, biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, 'not json');
    expect(out.response.biResult.template).toBe('T2');
    expect(out.response.answer).toBe(biResult.interpretation);
  });

  it('carries topN/sort into cardSpec.params too (so a re-opened card keeps its "上位N件"/並び順 chip state)', () => {
    const planWithTopN = { ...biPlan, topN: 5, sort: 'value_asc' };
    const out = run({ biResult, biPlan: planWithTopN, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, JSON.stringify({ narrative: '...' }));
    expect((out.response.cardSpec.params as { topN?: number; sort?: string }).topN).toBe(5);
    expect((out.response.cardSpec.params as { topN?: number; sort?: string }).sort).toBe('value_asc');
  });
});

// RELVA BI 追加要件定義書 §7 — ピン留めカードの永続化。カード=テンプレインスタンス統一
// モデル(§2)どおり、永続化するのは template+params+title だけ(表示済みdataは保存しない
// ——ダッシュボード表示時に毎回buildBiResultで新しく計算する。§3-3参照)。
describe('Build Pin Record node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Pin Record');

  it('builds a Supabase-insertable record from cardSpec, generating a fresh id', () => {
    const cardSpec = {
      template: 'T2',
      params: { metric: 'amount_sum', dimension: 'owner', period: { preset: 'current_fiscal_year' } },
      title: '担当者別 受注額',
      interpretation: '...',
      filtersApplied: [],
      data: { series: [] },
    };
    const out = runNode<{ id: string; template: string; params: unknown; title: string; pinned_by_name: string }>(
      jsCode,
      { $json: { body: { message: '__pin_card__', cardSpec, userName: '飯田' } } },
    ).json;
    expect(out.template).toBe('T2');
    expect(out.params).toEqual(cardSpec.params);
    expect(out.title).toBe('担当者別 受注額');
    expect(out.pinned_by_name).toBe('飯田');
    expect(out.id).toMatch(/^card_/);
    // dataは永続化しない(常に最新のkintoneレコードから再計算する)。
    expect(out).not.toHaveProperty('data');
    expect(out).not.toHaveProperty('interpretation');
  });

  it('regression: sort_order must fit Postgres integer (int4, max ~2.1e9) — Date.now() in ms overflows it', () => {
    const cardSpec = { template: 'T1', params: {}, title: 't', interpretation: '', filtersApplied: [], data: {} };
    const out = runNode<{ sort_order: number }>(jsCode, { $json: { body: { message: '__pin_card__', cardSpec } } }).json;
    expect(out.sort_order).toBeLessThan(2_147_483_647);
    expect(Number.isInteger(out.sort_order)).toBe(true);
  });
});

describe('Collect Pinned Cards node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Collect Pinned Cards');

  it('wraps all incoming pinned-card rows into a single { cards: [...] } item', () => {
    const $input = { all: () => [{ json: { id: 'card_1', template: 'T2' } }, { json: { id: 'card_2', template: 'T4' } }] };
    const out = runNode<{ cards: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ cards: [{ id: 'card_1', template: 'T2' }, { id: 'card_2', template: 'T4' }] });
  });

  it('produces an empty cards array when nothing is pinned yet', () => {
    const $input = { all: () => [] };
    const out = runNode<{ cards: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ cards: [] });
  });

  it('filters out the placeholder empty item n8n forces through on a 0-row alwaysOutputData response (regression: this once surfaced as a phantom 7th dashboard card with no template/params)', () => {
    const $input = { all: () => [{ json: {} }] };
    const out = runNode<{ cards: unknown[] }>(jsCode, { $input }).json;
    expect(out).toEqual({ cards: [] });
  });
});
