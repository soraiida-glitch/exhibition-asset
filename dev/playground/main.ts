import { renderBarH } from '../../src/customize/charts/barH';
import { renderDonut } from '../../src/customize/charts/donut';
import { renderFunnel } from '../../src/customize/charts/funnel';
import { renderHeatmap } from '../../src/customize/charts/heatmap';
import { renderKpiCard } from '../../src/customize/charts/kpiCard';
import { renderRecordList } from '../../src/customize/charts/recordList';
import type { BiResult } from '../../src/semantic/templates';

// hardcoded fixtures — 見た目の調整はここで完結させる(kintoneへのデプロイは不要)。
// 実データの形はいずれ n8n の Aggregate BI ノード(agent-workflow.ts)が組み立てる BiResult と一致する。

const T1_FIXTURE: BiResult<'T1'> = {
  template: 'T1',
  title: '今期の受注額',
  interpretation: '今期(2026-04-01〜2027-03-31)で受注額を集計しました。',
  filtersApplied: [{ label: '期間', value: '今期' }],
  data: { value: 3_000_000, unit: '円', delta: { base: '前期', diff: 500_000, pct: 20 } },
  narrative: '今期の受注額は300万円で、前期比+20%です。好調なペースを維持しています。',
  actions: [{ label: '担当者別に見る', routerQuery: '受注額を担当者別に見せて' }],
};

const T2_BARH_FIXTURE: BiResult<'T2'> = {
  template: 'T2',
  title: '担当者別の受注額',
  interpretation: '今期で受注額を担当者別に集計しました。',
  filtersApplied: [{ label: '期間', value: '今期' }],
  data: {
    metric: { code: 'amount_sum', label: '金額合計', unit: '円' },
    dimension: { code: 'owner', label: '担当者' },
    series: [
      { key: '佐藤', value: 3_000_000 },
      { key: '鈴木', value: 1_800_000 },
      { key: '田中', value: 900_000 },
    ],
  },
  narrative: '佐藤さんが300万円でトップです。',
};

const T2_DONUT_FIXTURE: BiResult<'T2'> = {
  template: 'T2',
  title: '流入経路別のリード数',
  interpretation: '件数を流入経路別に集計しました。',
  filtersApplied: [],
  data: {
    metric: { code: 'count', label: '件数', unit: '件' },
    dimension: { code: 'lead_source', label: '流入経路' },
    series: [
      { key: '名刺', value: 12 },
      { key: '問い合わせフォーム', value: 8 },
      { key: '紹介', value: 4 },
      { key: 'その他', value: 2 },
    ],
  },
  narrative: '名刺経由が最多(12件)です。',
};

const T4_FIXTURE: BiResult<'T4'> = {
  template: 'T4',
  title: 'パイプライン',
  interpretation: '件数をフェーズ別に集計しました。',
  filtersApplied: [],
  data: {
    metric: { code: 'count', label: '件数', unit: '件' },
    steps: [
      { stage: '初期接触', value: 20 },
      { stage: 'ヒアリング', value: 14 },
      { stage: '提案中', value: 9 },
      { stage: '見積提出', value: 6 },
      { stage: '交渉中', value: 4 },
      { stage: '成約', value: 2 },
      { stage: '失注', value: 5 },
    ],
  },
  narrative: '初期接触からヒアリングへの通過率は70%です。',
};

const T5_FIXTURE: BiResult<'T5'> = {
  template: 'T5',
  title: '失注理由 × 業種',
  interpretation: '失注のみで件数を失注理由×業種別に集計しました。',
  filtersApplied: [{ label: 'フェーズ', value: '失注' }],
  data: {
    metric: { code: 'count', label: '件数', unit: '件' },
    rows: { code: 'loss_reason', label: '失注理由' },
    cols: { code: 'industry', label: '業種' },
    matrix: [
      { row: '価格', col: 'IT・ソフトウェア', value: 5 },
      { row: '価格', col: '製造', value: 2 },
      { row: '価格', col: '小売・流通', value: 1 },
      { row: '競合', col: 'IT・ソフトウェア', value: 3 },
      { row: '競合', col: '製造', value: 4 },
      { row: '競合', col: '小売・流通', value: 1 },
      { row: 'タイミング', col: 'IT・ソフトウェア', value: 1 },
      { row: 'タイミング', col: '製造', value: 1 },
      { row: 'タイミング', col: '小売・流通', value: 2 },
    ],
  },
  narrative: 'IT・ソフトウェア業種では「価格」を理由とした失注が最も多く見られます。',
  actions: [{ label: '価格×IT・ソフトウェアの案件一覧', routerQuery: '価格が理由で失注したIT・ソフトウェア業種の案件一覧を見せて' }],
};

const T8_FIXTURE: BiResult<'T8'> = {
  template: 'T8',
  title: '今月クロージング予定の案件',
  interpretation: 'クロージング予定日が今月の案件一覧です。',
  filtersApplied: [{ label: '期間', value: '2026年8月' }],
  data: {
    columns: ['deal_name', 'account', 'amount', 'stage', 'owner', 'close_date'],
    records: [
      { deal_name: '基幹システム刷新', account: 'テック商事', amount: '2000000', stage: '交渉中', owner: '佐藤', close_date: '2026-08-15' },
      { deal_name: '在庫管理クラウド化', account: '山田製作所', amount: '1200000', stage: '見積提出', owner: '鈴木', close_date: '2026-08-28' },
    ],
  },
  narrative: '今月中に2件、合計320万円のクロージング予定があります。',
};

function panel(title: string, interpretation: string): { root: HTMLDivElement; chart: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'panel';
  root.innerHTML = `<h2>${title}</h2><p class="interpretation">${interpretation}</p>`;
  const chart = document.createElement('div');
  chart.className = 'chart';
  root.appendChild(chart);
  document.getElementById('app')!.appendChild(root);
  return { root, chart };
}

function mountKpi(title: string, result: BiResult<'T1'>) {
  const { chart } = panel(`T1 KpiCard — ${title}`, result.interpretation);
  chart.style.height = 'auto';
  renderKpiCard(chart, result.data);
}

function mountBarH(title: string, result: BiResult<'T2'>) {
  const { chart } = panel(`T2 BarH — ${title}`, result.interpretation);
  renderBarH(chart, result.data);
}

function mountDonut(title: string, result: BiResult<'T2'>) {
  const { chart } = panel(`T2 Donut — ${title}`, result.interpretation);
  renderDonut(chart, result.data);
}

function mountFunnel(title: string, result: BiResult<'T4'>) {
  const { chart } = panel(`T4 Funnel — ${title}`, result.interpretation);
  renderFunnel(chart, result.data);
}

function mountHeatmap(title: string, result: BiResult<'T5'>) {
  const { chart } = panel(`T5 Heatmap — ${title}`, result.interpretation);
  renderHeatmap(chart, result.data);
}

function mountRecordList(title: string, result: BiResult<'T8'>) {
  const { chart } = panel(`T8 RecordList — ${title}`, result.interpretation);
  chart.style.height = 'auto';
  renderRecordList(chart, result.data);
}

mountKpi(T1_FIXTURE.title, T1_FIXTURE);
mountBarH(T2_BARH_FIXTURE.title, T2_BARH_FIXTURE);
mountDonut(T2_DONUT_FIXTURE.title, T2_DONUT_FIXTURE);
mountFunnel(T4_FIXTURE.title, T4_FIXTURE);
mountHeatmap(T5_FIXTURE.title, T5_FIXTURE);
mountRecordList(T8_FIXTURE.title, T8_FIXTURE);
