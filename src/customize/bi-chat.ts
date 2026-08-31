/**
 * RELVA BI (要件定義書 §6) — チャット内での BiResult 描画。
 *
 * ここでの役割は「チャートを出す」ことと「ドリルダウン用のアクションボタンを出す」ことだけ。
 * interpretation/narrative の文言はチャットの吹き出し本文(pushAI の text 引数、
 * n8n の Format BI Response が既に組み立て済み)として表示されるため、ここで重複して
 * 表示しない — チャート+アクションのみをその下に差し込む。
 */
import { renderBarH } from './charts/barH';
import { renderDonut } from './charts/donut';
import { renderFunnel } from './charts/funnel';
import { renderHeatmap } from './charts/heatmap';
import { renderKpiCard } from './charts/kpiCard';
import { renderRecordList } from './charts/recordList';
import { escHtml } from './html-utils';
import { THEME } from './theme';
import type { BiResult, DimensionSeries, PayloadFor } from '../semantic/templates';

function injectBiChatStyles(): void {
  if (document.getElementById('exh-bi-chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-chat-styles';
  style.textContent = `
.exh-bi-panel { margin-top: 10px; }
.exh-bi-chart-host { width: 100%; height: 220px; }
.exh-bi-chart-host.exh-bi-chart-tall { height: 260px; }
/* T5(クロス集計)は業種等の多いカテゴリ軸を持ち、チャットパネルのような狭い横幅では
   軸ラベル・visualMap凡例が重なって崩れる(実際に「汚いグラフ」として報告された)。
   最低幅を確保しつつ、収まらない分は横スクロールさせる(ダッシュボードの広いカードでは
   最低幅を十分上回るため、スクロールは発生せずそのまま全幅で表示される)。 */
.exh-bi-heatmap-scroll { width: 100%; overflow-x: auto; }
.exh-bi-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.exh-bi-action-btn { border: 1px solid ${THEME.mistLine}; background: #fff; color: ${THEME.soraDeep};
  font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.exh-bi-action-btn:hover { background: ${THEME.cloud}; }
.exh-bi-pin-btn { border: 1px solid ${THEME.mistLine}; background: #fff; color: ${THEME.ink};
  font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; cursor: pointer;
  margin-top: 8px; display: inline-flex; align-items: center; gap: 4px; }
.exh-bi-pin-btn:hover { background: ${THEME.cloud}; }
.exh-bi-pin-btn.exh-bi-pinned { color: ${THEME.soraDeep}; border-color: ${THEME.sora}; background: ${THEME.cloud}; cursor: default; }
`;
  document.head.appendChild(style);
}

/** T2の描画コンポーネント選択(レンダリング上の判断であり、意味論層の関心ではない):
 * カテゴリ数が少ない(全体に占める割合を見せたい)場合はDonut、それ以外(ランキング表示)はBarH。 */
function pickT2Component(series: DimensionSeries[]): 'donut' | 'barH' {
  return series.length > 0 && series.length <= 6 ? 'donut' : 'barH';
}

/**
 * container にチャートだけを描画する(アクション行は含まない)。テンプレ別のコンポーネント
 * 選択ロジックをここに一本化し、チャット内表示(renderBiResult)とダッシュボード
 * (src/customize/dashboard.ts)の両方がこの同じ関数を使う——チャートの出し分けが経路によって
 * ズレないようにするため。返り値の関数で(ECharts系のみ)後始末できる。
 */
export function renderBiChart(container: HTMLElement, biResult: BiResult): () => void {
  injectBiChatStyles();
  container.innerHTML = '';

  const chartHost = document.createElement('div');
  chartHost.className = 'exh-bi-chart-host';

  // T5だけは横スクロール可能なラッパーの中に置く(狭いチャットパネルでも軸ラベル・凡例が
  // 崩れないよう最低幅を確保するため)。他のテンプレはcontainer直下でよい。
  if (biResult.template === 'T5') {
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'exh-bi-heatmap-scroll';
    container.appendChild(scrollWrap);
    chartHost.classList.add('exh-bi-chart-tall');
    chartHost.style.minWidth = '560px';
    scrollWrap.appendChild(chartHost);
  } else {
    container.appendChild(chartHost);
  }

  let dispose: (() => void) | undefined;
  switch (biResult.template) {
    case 'T1':
      chartHost.classList.remove('exh-bi-chart-host');
      chartHost.style.height = 'auto';
      renderKpiCard(chartHost, biResult.data as PayloadFor<'T1'>);
      break;
    case 'T2': {
      const payload = biResult.data as PayloadFor<'T2'>;
      dispose =
        pickT2Component(payload.series) === 'donut' ? renderDonut(chartHost, payload) : renderBarH(chartHost, payload);
      break;
    }
    case 'T4':
      dispose = renderFunnel(chartHost, biResult.data as PayloadFor<'T4'>);
      break;
    case 'T5':
      dispose = renderHeatmap(chartHost, biResult.data as PayloadFor<'T5'>);
      break;
    case 'T8':
      chartHost.classList.remove('exh-bi-chart-host');
      chartHost.style.height = 'auto';
      renderRecordList(chartHost, biResult.data as PayloadFor<'T8'>);
      break;
    default:
      chartHost.textContent = '';
  }

  return () => dispose?.();
}

/** container に BiResult(チャート+ドリルダウン用のアクションボタン+ピン留めボタン)を
 * 描画する。返り値の関数で(ECharts系のみ)後始末できる。
 * `onPin` は「📌 ダッシュボードにピン留め」ボタンのクリック時に呼ばれる(RELVA BI 追加要件
 * 定義書 §3 — チャットの会話結果をダッシュボードのカードに変換する唯一の入口)。cardSpecが
 * 無い応答(一般チャット等)にはピンボタンを出さないため省略可能。 */
export function renderBiResult(
  container: HTMLElement,
  biResult: BiResult,
  onDrill: (routerQuery: string) => void,
  onPin?: () => void,
): () => void {
  container.className = 'exh-bi-panel';
  container.innerHTML = '';

  const chartHost = document.createElement('div');
  container.appendChild(chartHost);
  const dispose = renderBiChart(chartHost, biResult);

  if (biResult.actions?.length) {
    const actionsRow = document.createElement('div');
    actionsRow.className = 'exh-bi-actions';
    for (const action of biResult.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exh-bi-action-btn';
      btn.textContent = action.label;
      btn.title = escHtml(action.routerQuery);
      btn.addEventListener('click', () => onDrill(action.routerQuery));
      actionsRow.appendChild(btn);
    }
    container.appendChild(actionsRow);
  }

  if (onPin) {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'exh-bi-pin-btn';
    pinBtn.textContent = '📌 ダッシュボードにピン留め';
    pinBtn.addEventListener('click', () => {
      pinBtn.disabled = true;
      pinBtn.classList.add('exh-bi-pinned');
      pinBtn.textContent = '📌 ピン留めしました';
      onPin();
    });
    container.appendChild(pinBtn);
  }

  return dispose;
}
