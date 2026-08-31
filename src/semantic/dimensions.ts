import {
  ACCOUNT_INDUSTRY_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  LOSS_REASON_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';

/**
 * RELVA BI (要件定義書 §3) — 次元(dimension)の定義。単一の真実源。`options` は
 * src/apps/schema.ts の DROP_DOWN 選択肢定数をそのまま参照し、二重管理しない。
 *
 * `field` はこの次元が実際に読む kintone のフィールドコード。lead_source/lead_status は
 * ユーザー向けの意味論名と実フィールドコード(source/status)が異なる点に注意。
 */

export type DimensionCode =
  | 'owner'
  | 'stage'
  | 'industry'
  | 'loss_reason'
  | 'account'
  | 'lead_source'
  | 'lead_status';

export type DimensionTargetApp = 'opportunity' | 'lead';

export interface DimensionDef {
  code: DimensionCode;
  label: string;
  field: string;
  targetApp: DimensionTargetApp;
  options?: readonly string[];
}

export const DIMENSIONS: Record<DimensionCode, DimensionDef> = {
  owner: { code: 'owner', label: '担当者', field: 'owner', targetApp: 'opportunity' },
  stage: {
    code: 'stage',
    label: 'フェーズ',
    field: 'stage',
    targetApp: 'opportunity',
    options: OPPORTUNITY_STAGE_OPTIONS,
  },
  industry: {
    code: 'industry',
    label: '業種',
    field: 'industry',
    targetApp: 'opportunity',
    options: ACCOUNT_INDUSTRY_OPTIONS,
  },
  loss_reason: {
    code: 'loss_reason',
    label: '失注理由',
    field: 'loss_reason',
    targetApp: 'opportunity',
    options: LOSS_REASON_OPTIONS,
  },
  account: { code: 'account', label: '取引先', field: 'account', targetApp: 'opportunity' },
  lead_source: {
    code: 'lead_source',
    label: '流入経路',
    field: 'source',
    targetApp: 'lead',
    options: LEAD_SOURCE_OPTIONS,
  },
  lead_status: {
    code: 'lead_status',
    label: 'リードステータス',
    field: 'status',
    targetApp: 'lead',
    options: LEAD_STATUS_OPTIONS,
  },
};

export const DIMENSION_CODES = Object.keys(DIMENSIONS) as DimensionCode[];

export function isDimensionCode(value: string): value is DimensionCode {
  return Object.prototype.hasOwnProperty.call(DIMENSIONS, value);
}

/** リード側の次元(lead_source/lead_status)は amount/stage を持たないため、件数以外の指標と組み合わせられない。 */
export function isMetricDimensionCompatible(metricCode: string, dimensionCode?: DimensionCode): boolean {
  if (!dimensionCode) return true;
  const dim = DIMENSIONS[dimensionCode];
  if (!dim) return false;
  return dim.targetApp === 'lead' ? metricCode === 'count' : true;
}
