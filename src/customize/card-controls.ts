/**
 * RELVA BI 追加要件定義書 §3-1・§3-2 — 対話的リファインメント「ワンクリックチップ」。
 *
 * Power BIの「X軸/Y軸を選ぶ」画面のような直感的な操作感を目指しつつ、中身は§6の絶対
 * ガードレール(意味レイヤーの内側だけ・自由なフィールド選択は禁止)を厳密に守る——
 * ここに並ぶチップは必ず DIMENSIONS/METRICS(意味レイヤーの単一の真実源)から生成され、
 * 存在しない/未検証の組み合わせのボタンは絶対に出さない。
 *
 * 実装は驚くほど単純: 各チップは§3-2の例文("業種で見せて"「先月で」「上位5件だけ」)と
 * 全く同じ自然文をそのままチャットへ送るだけ(handleSendを呼ぶのと同じ経路)。router/
 * Parse BI Planの既存のrefine処理(cards.tsのrefine())をそのまま再利用し、チップ専用の
 * バックエンドロジックを別に持たない——「入口が2つ(チップと自然言語)、処理は1本」。
 *
 * どのチップを出すか(computeChipGroups)とDOMへの描画(renderCardControls)を分離している
 * ——前者はDOMに一切触れない純関数なので、jsdom無しで直接テストできる。
 */
import type { ChatCardState, TemplateParams } from '../semantic/cards';
import { allowedParamKeys } from '../semantic/cards';
import { DIMENSIONS, type DimensionCode } from '../semantic/dimensions';
import { METRICS, type MetricCode } from '../semantic/metrics';
import { THEME } from './theme';

export interface ChipDef {
  label: string;
  phrase: string;
}

export interface ChipGroup {
  label: string;
  chips: ChipDef[];
}

const PERIOD_CHIPS: { preset: 'current_fiscal_year' | 'current_month' | 'last_month' | 'all'; label: string; phrase: string }[] = [
  { preset: 'current_fiscal_year', label: '今期', phrase: '今期で見せて' },
  { preset: 'current_month', label: '今月', phrase: '今月で見せて' },
  { preset: 'last_month', label: '先月', phrase: '先月で見せて' },
  { preset: 'all', label: '全期間', phrase: '全期間で見せて' },
];

const TOPN_CHIPS: ChipDef[] = [
  { label: '上位5件', phrase: '上位5件だけ見せて' },
  { label: '上位10件', phrase: '上位10件だけ見せて' },
];

const SORT_CHIPS: ChipDef[] = [
  { label: '多い順', phrase: '多い順に並べて' },
  { label: '少ない順', phrase: '少ない順に並べて' },
];

function currentPeriodPreset(params: TemplateParams): string {
  const p = params.period;
  return p && 'preset' in p ? p.preset : 'current_fiscal_year';
}

/**
 * 現在のカード(card)に対して意味を持つチップ「グループ」だけを計算する純関数。
 * §3-1の表(テンプレごとに操作可能なパラメータが決まっている——refine()のガードレールと
 * 完全に同じ表)を参照し、存在しない/組み合わせ不可能なチップは絶対に生成しない。
 */
export function computeChipGroups(card: ChatCardState): ChipGroup[] {
  const allowed = allowedParamKeys(card.template);
  const groups: ChipGroup[] = [];

  if (allowed.includes('period')) {
    const current = currentPeriodPreset(card.params);
    const chips = PERIOD_CHIPS.filter((c) => c.preset !== current).map((c) => ({ label: c.label, phrase: c.phrase }));
    if (chips.length > 0) groups.push({ label: '期間', chips });
  }

  if (allowed.includes('dimension')) {
    const currentDim = card.params.dimension;
    const currentDimDef = currentDim ? DIMENSIONS[currentDim] : undefined;
    // 現在の次元と同じ対象(案件/リード)の次元だけを候補にする——組み合わせ不可能な
    // (リード×金額のような)チップを絶対に出さないための、runAggregate側と同じ制約。
    const candidates = (Object.values(DIMENSIONS) as { code: DimensionCode; label: string; targetApp: 'opportunity' | 'lead' }[]).filter(
      (def) => def.code !== currentDim && (!currentDimDef || def.targetApp === currentDimDef.targetApp),
    );
    if (candidates.length > 0) {
      groups.push({ label: '切り口', chips: candidates.map((def) => ({ label: def.label, phrase: `${def.label}で見せて` })) });
    }
  }

  // 指標の切り替えは案件側の次元(または次元なし)のときだけ提案する——リード側の次元は
  // count以外の指標と組み合わせられないため(runAggregateのガード、DIMENSIONS参照)。
  if (allowed.includes('metric')) {
    const currentDim = card.params.dimension;
    const currentDimDef = currentDim ? DIMENSIONS[currentDim] : undefined;
    const isLeadSide = currentDimDef?.targetApp === 'lead';
    if (!isLeadSide) {
      const candidates = (Object.values(METRICS) as { code: MetricCode; label: string }[]).filter((def) => def.code !== card.params.metric);
      if (candidates.length > 0) {
        groups.push({ label: '指標', chips: candidates.map((def) => ({ label: def.label, phrase: `${def.label}で見せて` })) });
      }
    }
  }

  if (allowed.includes('topN')) groups.push({ label: '件数', chips: TOPN_CHIPS });
  if (allowed.includes('sort')) groups.push({ label: '並び順', chips: SORT_CHIPS });

  return groups;
}

function injectCardControlsStyles(): void {
  if (document.getElementById('exh-card-controls-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-card-controls-styles';
  style.textContent = `
.exh-card-controls { margin-top: 10px; }
.exh-card-controls-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.exh-card-controls-label { font-size: 11px; font-weight: 700; color: ${THEME.ink}; opacity: .6; min-width: 44px; }
.exh-card-controls-chip { border: 1px solid ${THEME.mistLine}; background: #fff; color: ${THEME.soraDeep};
  font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.exh-card-controls-chip:hover { background: ${THEME.cloud}; }
`;
  document.head.appendChild(style);
}

/**
 * container に、computeChipGroups() が計算したチップを描画する。クリックすると自然文が
 * onChipClick に渡されるだけで、チャット送信自体は呼び出し側(chat.ts の handleSend)が行う。
 */
export function renderCardControls(container: HTMLElement, card: ChatCardState, onChipClick: (phrase: string) => void): void {
  const groups = computeChipGroups(card);
  container.innerHTML = '';
  if (groups.length === 0) return;

  injectCardControlsStyles();
  container.className = 'exh-card-controls';

  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'exh-card-controls-group';
    const labelEl = document.createElement('span');
    labelEl.className = 'exh-card-controls-label';
    labelEl.textContent = group.label;
    row.appendChild(labelEl);

    for (const chip of group.chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exh-card-controls-chip';
      btn.textContent = chip.label;
      btn.addEventListener('click', () => onChipClick(chip.phrase));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }
}
