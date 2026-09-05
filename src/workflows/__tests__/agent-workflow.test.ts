import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAgentWorkflow } from '../agent-workflow';

// テスト専用の使い捨てRSA鍵ペア(実在のGCPサービスアカウントとは無関係——Build Vertex JWT
// ノードの署名ロジックを、実際に検証可能な形で単体テストするためだけに生成したもの)。
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDARW3bqYb0BFUF
QtbFNFYM3AeSLMeC5UzJU9NHrVEGDW7Ctdb47tChIG/JUX+zqp3o/FnIiKL+J3P/
/aWC+cV1Sb688LeMxj7s+avRGJqMrffwiYdVAHgLcJUCmO74ggWSHD3rqpXxJrl7
U/Xp19E+H+7KXEwyK/EkhdUTVj97BbHePWOs5DY4DtZNH6gz8B2iwTW8TMKbJLe4
R9gyYzwq+VHHO78VgTVtq2UP9lTfu4r+oXqZJR9p6ZRjdJKBs6bZ1MLhj41eGA7s
cN3ld5EmiUCCwu3Gs/rgY2cFco+UpUXzu+Wf2R6k+4RzLBMTID8ofz3u0/hWltev
LG631DORAgMBAAECggEABjGmZJttPsqt732z/AXf2Mm0z7t0EO4wn1K9PXOiptKD
dS/U9U+CNpKcL0zaE5BlRmZswQZP0+ay+LXz4UiJGSpvQ9hwXU9coxc29wU3I12O
XXgcvTsG4v11O3BwUF6l7ctNnlwwOOTRuFyf0TDz62+tamT3Sm16dv39u4H9iQm7
X6FZx4asuE0OSsD1P1Hl7g0rQWxv9IbsQ9EhnnO+7IOBaLTMbYgFdfyqup5ql9Rp
o79sqSk/gN1yuGviGjV0r8GKCaj2fSmDEtA8J02lep9KZTmx/r8XV1RRi63SgQb3
2ifeW8w1SuCEvKKhlRi/3y6YhCf0nvjXWpa7hKmmrQKBgQDmDJQ6BRC86eGbnxPv
I3WMPUpySjTYY50BS4EfSyD+FgvmwcEghArgp/3RXBrwvVDjMpNZgPqCeyOv+a0X
3Ubqa0YYYYmIfAPZg/hVrQzX80YseAJxsaG2kLRK+CI9k+DJNp9Z5wtntkY4X14L
CzQKGek6UJCGMlMxTCEkizO/HQKBgQDV9eOO26NOQ0K13i8hGRH8QjJt45Cb3C3b
f/o7sn+0H10qAMFTQlGuxdgsBmoFrVgTqhiRfNG+S2M14dbvrDVVy0KDMHMhdDD6
aIY86pCkX1X98PljJCB5MCsrNY5hezVUb8jZAHzTkZOqVamRWulz2FvJoLEl8Qnc
1sWOFwXYBQKBgBP2bXpnbB9okDpH4Jv00MN9ohMu200Xv80X9zl29IL3+Mpqb87Z
hnQeP8lGG9ReKUG95slyhsqB0wP3P4z9l6TJ8Eg3Vo7wbAkZCZitrpqisqkzNMsW
5fiIsAx9YcNELNJpGgTcJsI2L/u+UtPUggyKWRHFYfUzMsLpX0rjhXcFAoGAJ/aq
j1dk9ExJ3JBoeyUkn9p5ct8LdqE0i4gm5BmeErW9AAhuE7ASc7OOggKcsPzEs7+U
oTAQORv5punM7K1ctO6nOLvG9VuvfkYhtKUXaSxJcooc+rCXxCsEFSkGtByARIow
mJ+nsRjC3RDtADJb4oBp/IogLHcOIYqYEccpF0UCgYBpDvqCAaUTPweFHaYsHa8x
sX1ET4wCmzlY4IWPBh+IvmxBWrKmvF8S4qI1c0SjzVDeNvf5OX+uUzPDLYSdAsVb
y8liwnEZn23ufOOEbvi8dKTIDUzCjzIU38+p0KNC2PX+V0ccrx/w7lXFynbYsdfZ
Zu/bK/JXhR9qEpxiswvG7A==
-----END PRIVATE KEY-----
`;

const CONFIG = {
  webhookSecret: 'secret',
  openaiApiKey: 'x',
  googleServiceAccountEmail: 'n8n-test@example.iam.gserviceaccount.com',
  googleServiceAccountPrivateKey: TEST_PRIVATE_KEY,
  vertexProjectId: 'example-project',
  vertexRegion: 'global',
  vertexClaudeModelId: 'claude-haiku-4-5',
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

// Build Vertex JWT はトップレベルawait(crypto.subtle.importKey/sign)を使う——n8nのCode
// nodeはトップレベルawaitを標準サポートしているため、テスト側もAsyncFunctionで同じ実行
// モデルを再現する(new Functionは同期関数しか作れずawaitを含むコードでSyntaxErrorになる)。
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
async function runNodeAsync<T = Record<string, unknown>>(jsCode: string, context: Record<string, unknown>): Promise<{ json: T }> {
  const argNames = Object.keys(context);
  const argValues = Object.values(context);
  const fn = new AsyncFunction(...argNames, jsCode);
  const result = (await fn(...argValues)) as [{ json: T }];
  return result[0];
}

describe('buildAgentWorkflow — generated Code node syntax', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const codeNodeNames = (wf.nodes as WorkflowNodeLike[])
    .filter((n) => !!n.parameters?.jsCode)
    .map((n) => n.name);

  // AsyncFunctionでチェックする——Build Vertex JWTのようにトップレベルawaitを使うノード
  // (n8nのCode nodeが標準サポートする書き方)は、素のnew Functionだと構文エラーになる。
  // AsyncFunctionはawaitを含まない既存の同期的なコードもそのまま実行できるため、全ノード
  // 共通でこちらに統一して問題ない。
  it.each(codeNodeNames)('%s has syntactically valid jsCode', (name) => {
    expect(() => new AsyncFunction(jsCodeOf(wf.nodes, name))).not.toThrow();
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

  // グラフ単位のチャット拡張の回帰テスト: これらのフラグはルーターLLMのpatchには含まれない
  // (自然言語で見た目そのものを変えさせない、という意図的な設計)が、refine()自体は
  // currentCard.paramsからそのまま引き継ぐ——それをplan構築時に落とさず運ぶことを確認する。
  // 落とすと、散布図・月別推移カードを自然言語でリファインした瞬間に普通のカテゴリ別集計へ
  // 静かに戻ってしまう(buildBiResultがplan.scatter/plan.timeGranularityを見て分岐するため)。
  it('op:refine keeps timeGranularity/scatter/visual from currentCard even though the patch never sets them', () => {
    const scatterCard = {
      template: 'T2',
      params: { dimension: 'owner', period: { preset: 'current_fiscal_year' }, scatter: true, visual: 'scatter' },
    };
    const out = run({ op: 'refine', period: 'last_month' }, { message: '先月で見せて', currentCard: scatterCard });
    expect(out.biPlan.period).toBe('last_month'); // 変更
    expect((out.biPlan as unknown as { scatter?: boolean }).scatter).toBe(true); // 維持
    expect((out.biPlan as unknown as { visual?: string }).visual).toBe('scatter'); // 維持

    const trendCard = {
      template: 'T2',
      params: { metric: 'count', period: { preset: 'current_fiscal_year' }, timeGranularity: 'month', visual: 'trend_line' },
    };
    const out2 = run({ op: 'refine', period: 'all' }, { message: '全期間で見せて', currentCard: trendCard });
    expect((out2.biPlan as unknown as { timeGranularity?: string }).timeGranularity).toBe('month'); // 維持
    expect((out2.biPlan as unknown as { visual?: string }).visual).toBe('trend_line'); // 維持
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

// RELVA_BI_開発方針報告書_v2.docx §3.5(AIによるインサイト・アドバイス)— query/refineの
// Aggregate BIの直後で、前期/先月/先々月との比較用factSheetを組み立てる。BI Narrative
// (LLM)にはこの文字列を渡すだけで、期間の解決・集計自体はここで決定的に行う。
describe('Build Comparison node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Comparison');

  function run(prevOutput: Record<string, unknown>, opportunityRecords: unknown[], leadRecords: unknown[] = []) {
    const $node = { 'Prepare BI Datasets': { json: { opportunityRecords, leadRecords } } };
    return runNode<{ comparisonFactSheet?: string | null; biResult?: unknown }>(jsCode, { $json: prevOutput, $node }).json;
  }

  // 2020年の日付なので、このテストが実際に実行される時刻がいつであっても
  // 「前期(直前の同種期間)」のレンジには入らない——実行時刻に依存しない安定したfixture。
  const OLD_OPPS = [{ stage: { value: '成約' }, amount: { value: '1000000' }, owner: { value: '佐藤' }, close_date: { value: '2020-05-01' } }];

  it('passes the upstream output through unchanged when Aggregate BI itself failed (no biResult)', () => {
    const out = run({ biAggregateError: 'x', biPlan: { template: 'T1', metric: 'count' } }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeUndefined();
  });

  it('produces null for a scatter plan (no single "1つ前の期間" for per-record points)', () => {
    const out = run({ biResult: { template: 'T2' }, biPlan: { template: 'T2', dimension: 'owner', scatter: true } }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeNull();
  });

  it('produces null for a month-trend plan (already covers a whole date range, not a single "前の期間")', () => {
    const out = run({ biResult: { template: 'T2' }, biPlan: { template: 'T2', metric: 'count', timeGranularity: 'month' } }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeNull();
  });

  it('produces null when period is "all" (no single comparison period exists)', () => {
    const out = run({ biResult: { template: 'T1' }, biPlan: { template: 'T1', metric: 'count', period: 'all' } }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeNull();
  });

  it('computes a real "前期" comparison factSheet for a plain T1 plan', () => {
    const out = run({ biResult: { template: 'T1' }, biPlan: { template: 'T1', metric: 'count', period: 'current_fiscal_year' } }, OLD_OPPS);
    // OLD_OPPS(2020-05-01)は前期のレンジ(直近1年強)には入らないため0件。
    expect(out.comparisonFactSheet).toBe('前期: 件数: 0件');
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

// RELVA_BI_開発方針報告書_v2.docx §3.5拡張 — narrateも(直前のカードの再集計こそしないが)
// 前期/先月/先々月との比較用factSheetを組み立てられるよう、Route After Datasets?経由で
// Prepare BI Datasets(query/refineと共有のフェッチ/キャッシュ経路)を通ってからここに来る。
describe('Build Narrate Comparison node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Narrate Comparison');

  function run(buildNarrateInputOutput: Record<string, unknown>, opportunityRecords: unknown[], leadRecords: unknown[] = []) {
    const $node = {
      'Build Narrate Input': { json: buildNarrateInputOutput },
      'Prepare BI Datasets': { json: { opportunityRecords, leadRecords } },
    };
    return runNode<{ comparisonFactSheet?: string | null; biResult?: unknown }>(jsCode, { $node }).json;
  }

  const OLD_OPPS = [{ stage: { value: '成約' }, amount: { value: '1000000' }, owner: { value: '佐藤' }, close_date: { value: '2020-05-01' } }];

  it('passes through unchanged when Build Narrate Input itself errored (currentCard missing data)', () => {
    const out = run({ biAggregateError: '見つかりませんでした' }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeUndefined();
  });

  it('computes a real "前期" comparison factSheet for the currentCard\'s template/metric', () => {
    const out = run(
      { biResult: { template: 'T1' }, biPlan: { template: 'T1', metric: 'count', period: 'current_fiscal_year' } },
      OLD_OPPS,
    );
    expect(out.comparisonFactSheet).toBe('前期: 件数: 0件');
  });

  it('produces null for a scatter/month-trend currentCard, same guardrail as Build Comparison', () => {
    const out = run({ biResult: { template: 'T2' }, biPlan: { template: 'T2', dimension: 'owner', scatter: true } }, OLD_OPPS);
    expect(out.comparisonFactSheet).toBeNull();
  });
});

// RELVA_BI_開発方針報告書_v2.docx §3.5 — AIによるインサイト・アドバイスはAnthropic Claude
// APIを採用する方針。httpRequestノードのjsonBody/urlはn8nの式({{ }})評価が必要なため
// new Functionでは実行できず(Aggregate BI等のCode nodeとは違う)、静的な設定値だけを
// 検証する——実際の疎通確認はデプロイ後にwebhookへ直接投げて確認する。
// RELVA_BI_開発方針報告書_v2.docx §3.5 — Vertex AI経由でClaudeを呼ぶ方式(社内のGCP
// プロジェクトでサービスアカウントを発行する形をユーザーが選択したため、直接のAnthropic
// APIキーではなくOAuth2アクセストークンで認証する)。トークン自体はBuild Vertex JWT/
// Fetch Vertex Tokenの2ノードで用意し、BI Narrativeはそれを使うだけ。
describe('Build Vertex JWT node (Google OAuth2 JWTベアラーグラント, RFC 7523)', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const jsCode = jsCodeOf(wf.nodes, 'Build Vertex JWT');

  // require("crypto")はn8nのCode node(task runner)で"Module 'crypto' is disallowed"として
  // 実機で拒否されることを確認済み(実際にライブでこの回帰が発生した)——グローバルの
  // Web Crypto API(crypto.subtle、requireを経由しない)へ書き換えた。トップレベルawaitを
  // 使うため、テストもAsyncFunctionで同じ実行モデルを再現する(runNodeAsync)。
  async function run(json: Record<string, unknown> = {}) {
    return (await runNodeAsync<{ jwt: string }>(jsCode, { $json: json })).json;
  }

  it('produces a syntactically valid 3-part JWT whose header/claims round-trip correctly', async () => {
    const out = await run({ sessionId: 's' });
    const parts = out.jwt.split('.');
    expect(parts).toHaveLength(3);

    const decode = (b64url: string) => JSON.parse(Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims.iss).toBe(CONFIG.googleServiceAccountEmail);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('signs the JWT with a signature verifiable against the service account public key (not just well-formed JSON)', async () => {
    const out = await run();
    const [headerB64, claimsB64, sigB64url] = out.jwt.split('.');
    const signingInput = `${headerB64}.${claimsB64}`;
    const signature = Buffer.from(sigB64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const publicKey = crypto.createPublicKey(TEST_PRIVATE_KEY);
    const ok = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
    expect(ok).toBe(true);
  });

  it('preserves whatever was already on $json (so downstream nodes still see biResult/biPlan etc.)', async () => {
    const out = (await run({ sessionId: 's', biResult: { template: 'T1' } })) as unknown as { sessionId: string; biResult: { template: string } };
    expect(out.sessionId).toBe('s');
    expect(out.biResult).toEqual({ template: 'T1' });
  });
});

describe('BI Narrative node (Claude on Vertex AI)', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const node = (wf.nodes as WorkflowNodeLike[]).find((n) => n.name === 'BI Narrative') as {
    parameters?: { url?: string; jsonBody?: string; headerParameters?: { parameters: { name: string; value: string }[] } };
  };

  it('targets the Vertex AI publisher-model endpoint for the configured project/region/model (not the direct Anthropic API)', () => {
    expect(node.parameters?.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/example-project/locations/global/publishers/anthropic/models/claude-haiku-4-5:rawPredict',
    );
  });

  it('uses a Bearer token from Fetch Vertex Token, not a static Anthropic API key', () => {
    const names = (node.parameters?.headerParameters?.parameters || []).map((p) => p.name);
    expect(names).toContain('Authorization');
    expect(names).not.toContain('x-api-key');
    const auth = node.parameters?.headerParameters?.parameters.find((p) => p.name === 'Authorization');
    expect(auth?.value).toContain('access_token');
  });

  it('puts anthropic_version in the body (not a header, per the Vertex AI request format) and omits "model" (it is in the URL)', () => {
    const body = node.parameters?.jsonBody || '';
    expect(body).toContain('anthropic_version: "vertex-2023-10-16"');
    expect(body).not.toMatch(/model:\s*"claude/);
  });

  it('requests max_tokens with an assistant-prefilled "{" (Anthropic has no response_format: json_object) and includes comparisonFactSheet', () => {
    const body = node.parameters?.jsonBody || '';
    expect(body).toContain('max_tokens');
    expect(body).toContain('role: "assistant"');
    expect(body).toContain('content: "{"');
    expect(body).toContain('comparisonFactSheet');
  });
});

describe('Fetch Vertex Token node', () => {
  const wf = buildAgentWorkflow(CONFIG);
  const node = (wf.nodes as WorkflowNodeLike[]).find((n) => n.name === 'Fetch Vertex Token') as {
    parameters?: { url?: string; contentType?: string; bodyParameters?: { parameters: { name: string; value: string }[] } };
  };

  it('targets Google\'s OAuth2 token endpoint with the JWT-bearer grant', () => {
    expect(node.parameters?.url).toBe('https://oauth2.googleapis.com/token');
    const params = node.parameters?.bodyParameters?.parameters || [];
    expect(params.find((p) => p.name === 'grant_type')?.value).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(params.find((p) => p.name === 'assertion')?.value).toContain('$json.jwt');
  });

  it('sends the body as form-urlencoded (the only content type Google\'s token endpoint accepts)', () => {
    expect(node.parameters?.contentType).toBe('form-urlencoded');
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

  // BI Narrative(Anthropic Messages API)はassistantメッセージを"{"でprefillして呼んでいる
  // ため、応答本文はJSONの続き(先頭の"{"を除いたもの)だけが返る。
  function run(prepareOutput: Record<string, unknown>, anthropicResponseText: string) {
    const $node = { 'Prepare BI Narrative Input': { json: prepareOutput } };
    const $json = { content: [{ type: 'text', text: anthropicResponseText }] };
    return runNode<FormatBiResponseOutput>(jsCode, { $node, $json }).json;
  }

  // 実運用のprefillの形(先頭"{"無し)をテストでも再現するヘルパー。
  function runWithNarrative(prepareOutput: Record<string, unknown>, narrativeObj: { narrative: string }) {
    return run(prepareOutput, JSON.stringify(narrativeObj).slice(1));
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
    const out = runWithNarrative({ biResult, biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, { narrative: '飯田さんが最も多く受注しています。' });
    expect(out.response.cardSpec).toEqual({
      template: 'T2',
      params: { metric: 'amount_sum', dimension: 'owner', dimensionB: undefined, filters: [], period: { preset: 'current_fiscal_year' } },
      title: biResult.title,
      interpretation: biResult.interpretation,
      filtersApplied: biResult.filtersApplied,
      data: biResult.data,
    });
  });

  // BI NarrativeがAnthropic Messages APIに変わった後も、assistantメッセージのprefill
  // ("{" — jsonBody参照)から返ってきた応答本文を正しく組み立て直してパースできることの
  // 回帰テスト。ここが壊れると、有効な応答でもnarrativeが常に空文字列にフォールバック
  // してしまう(この回帰は実際に発生した——parsing先を$json.choices[0].message.contentの
  // ままにしていたため、テストのモック形も合わせて古いままだと気づけなかった)。
  it('reconstructs the leading "{" from the assistant-prefill response before parsing (Anthropic Messages API shape)', () => {
    const out = runWithNarrative({ biResult, biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, { narrative: '飯田さんが好調です。' });
    expect(out.response.answer).toBe(biResult.interpretation + ' 飯田さんが好調です。');
  });

  it('falls back to the interpretation as the narrative when the LLM response is not valid JSON', () => {
    const out = run({ biResult, biPlan, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, 'not json');
    expect(out.response.biResult.template).toBe('T2');
    expect(out.response.answer).toBe(biResult.interpretation);
  });

  it('carries topN/sort into cardSpec.params too (so a re-opened card keeps its "上位N件"/並び順 chip state)', () => {
    const planWithTopN = { ...biPlan, topN: 5, sort: 'value_asc' };
    const out = runWithNarrative({ biResult, biPlan: planWithTopN, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, { narrative: '...' });
    expect((out.response.cardSpec.params as { topN?: number; sort?: string }).topN).toBe(5);
    expect((out.response.cardSpec.params as { topN?: number; sort?: string }).sort).toBe('value_asc');
  });

  // グラフ単位のチャット拡張(散布図・月別推移・選んだ見た目)の回帰テスト: これらが
  // cardSpec.paramsから落ちると、dashboard.tsのresolveVisual()が既定の見た目にフォール
  // バックしてしまい、チャットで一度リファインしただけでカードの見た目が変わってしまう。
  it('carries timeGranularity/scatter/visual into cardSpec.params too (so a refined scatter/trend card keeps its visual)', () => {
    const planWithVisual = { ...biPlan, timeGranularity: 'month', scatter: true, visual: 'scatter' };
    const out = runWithNarrative({ biResult, biPlan: planWithVisual, sessionId: 's', userId: 'u', userName: 'n', message: 'm' }, { narrative: '...' });
    const params = out.response.cardSpec.params as { timeGranularity?: string; scatter?: boolean; visual?: string };
    expect(params.timeGranularity).toBe('month');
    expect(params.scatter).toBe(true);
    expect(params.visual).toBe('scatter');
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
