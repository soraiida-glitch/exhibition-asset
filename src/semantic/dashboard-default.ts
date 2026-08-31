/**
 * RELVA BI 追加要件定義書 §5 — 初期ダッシュボードの既定カード構成(コードで定義)。
 * デモの物語(seed-demo-data.ts)に合わせた厳選6枚。表示順=配列順。
 */
import { createCard, type CardSpec } from './cards';

export function buildDefaultDashboardCards(): CardSpec[] {
  return [
    // 1. T1 受注額(今期・前年対比)
    createCard(
      'T1',
      { metric: 'won_amount', period: { preset: 'current_fiscal_year' } },
      { title: '受注額(今期)', pinned: true },
    ),
    // 2. T1 対応待ちリード(未対応件数) — dimensionを持たないT1でリードを対象にするため entity で明示。
    createCard(
      'T1',
      {
        metric: 'count',
        entity: 'lead',
        period: { preset: 'all' },
        filters: [{ field: 'status', op: '=', value: '未対応' }],
      },
      { title: '対応待ちリード', pinned: true },
    ),
    // 3. T4 商談パイプライン
    createCard('T4', { metric: 'count', period: { preset: 'current_fiscal_year' } }, { title: '商談パイプライン', pinned: true }),
    // 4. T2 失注理由の内訳(ドーナツ)— stage=失注 に絞ってはじめて意味を持つ次元。
    createCard(
      'T2',
      {
        metric: 'count',
        dimension: 'loss_reason',
        period: { preset: 'current_fiscal_year' },
        filters: [{ field: 'stage', op: '=', value: '失注' }],
      },
      { title: '失注理由の内訳', pinned: true },
    ),
    // 5. T2 担当者別 受注額(横棒)
    createCard(
      'T2',
      { metric: 'won_amount', dimension: 'owner', period: { preset: 'current_fiscal_year' } },
      { title: '担当者別 受注額', pinned: true },
    ),
    // 6. T5 失注理由 × 業種(ヒートマップ)— 今回の"刺さる分析"のフラッグシップ。
    createCard(
      'T5',
      {
        metric: 'count',
        dimension: 'loss_reason',
        dimensionB: 'industry',
        period: { preset: 'current_fiscal_year' },
        filters: [{ field: 'stage', op: '=', value: '失注' }],
      },
      { title: '失注理由 × 業種', pinned: true },
    ),
  ];
}
