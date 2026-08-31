/**
 * RELVA BI (要件定義書 §4) — チャート/回答テンプレートの構造化コントラクト。単一の真実源。
 * n8n Code node の出力(非型チェック)と bi-chat.ts / src/customize/charts/* の入力
 * (静的型チェック)の両方がこの型だけを参照する — 二重定義しない。
 *
 * v1スコープは T1・T2・T4・T5・T8 のみ(T3/T6/T7/T9はv2、要件定義書はアーキテクチャ上の
 * 言及のみで実装対象外)。
 */

export type TemplateId = 'T1' | 'T2' | 'T4' | 'T5' | 'T8';

export interface MetricView {
  code: string; // MetricCode (semantic/metrics.ts)
  label: string;
  unit: string;
}

export interface DimView {
  code: string; // DimensionCode (semantic/dimensions.ts)
  label: string;
}

/** ユーザーに表示する「適用中のフィルタ」1件分(例: { label: "期間", value: "今期(2026-04-01〜2027-03-31)" })。 */
export interface FilterView {
  label: string;
  value: string;
}

/** チャットの回答に添える「もっと見る」系の再質問アクション。routerQuery はそのままチャット欄に再送する自然文。 */
export interface DrillAction {
  label: string;
  routerQuery: string;
}

/** T2(カテゴリ別集計)1件分の系列ポイント。 */
export interface DimensionSeries {
  key: string;
  value: number;
}

export type PayloadFor<T extends TemplateId> = T extends 'T1'
  ? { value: number; unit: string; delta?: { base: string; diff: number; pct: number } }
  : T extends 'T2'
    ? { metric: MetricView; dimension: DimView; series: DimensionSeries[] }
    : T extends 'T4'
      ? { metric: MetricView; steps: { stage: string; value: number }[] }
      : T extends 'T5'
        ? {
            metric: MetricView;
            rows: DimView;
            cols: DimView;
            matrix: { row: string; col: string; value: number }[];
          }
        : T extends 'T8'
          ? { columns: string[]; records: Record<string, string>[]; recordUrlField?: string }
          : never;

export interface BiResult<T extends TemplateId = TemplateId> {
  template: T;
  title: string;
  /** 何を集計したかを明示する一文。narrative と違い、必ず含める決定的な文言(LLM生成ではない)。 */
  interpretation: string;
  filtersApplied: FilterView[];
  data: PayloadFor<T>;
  /** LLM生成の1〜2文のナレーション。data に既にある数値のみ引用してよく、新しい数値を計算・発明してはならない。 */
  narrative: string;
  actions?: DrillAction[];
}

export const TEMPLATE_IDS: TemplateId[] = ['T1', 'T2', 'T4', 'T5', 'T8'];

export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as string[]).includes(value);
}
