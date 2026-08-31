/**
 * RELVA BI (要件定義書 §3) — 指標(metric)の定義。単一の真実源: ここに無い metric コードは
 * ルーター(agent-workflow.ts)にもチャート側にも存在しない、という前提で全体を設計する。
 * "活動量" はユーザー確認済みでv1対象外(意図的に定義しない)。
 */

export type MetricCode =
  | 'count'
  | 'amount_sum'
  | 'amount_avg'
  | 'won_amount'
  | 'won_count'
  | 'lost_count'
  | 'win_rate';

export interface MetricDef {
  code: MetricCode;
  label: string;
  unit: string;
}

export const METRICS: Record<MetricCode, MetricDef> = {
  count: { code: 'count', label: '件数', unit: '件' },
  amount_sum: { code: 'amount_sum', label: '金額合計', unit: '円' },
  amount_avg: { code: 'amount_avg', label: '平均金額', unit: '円' },
  won_amount: { code: 'won_amount', label: '受注額', unit: '円' },
  won_count: { code: 'won_count', label: '受注件数', unit: '件' },
  lost_count: { code: 'lost_count', label: '失注件数', unit: '件' },
  // 受注(成約)・失注のみをクローズ済みとみなす。分母に進行中の案件は含めない(§3)。
  win_rate: { code: 'win_rate', label: '受注率', unit: '%' },
};

export const METRIC_CODES = Object.keys(METRICS) as MetricCode[];

export function isMetricCode(value: string): value is MetricCode {
  return Object.prototype.hasOwnProperty.call(METRICS, value);
}
