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
.exh-bi-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.exh-bi-action-btn { border: 1px solid ${THEME.mistLine}; background: #fff; color: ${THEME.soraDeep};
  font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.exh-bi-action-btn:hover { background: ${THEME.cloud}; }
`;
  document.head.appendChild(style);
}

/** T2の描画コンポーネント選択(レンダリング上の判断であり、意味論層の関心ではない):
 * カテゴリ数が少ない(全体に占める割合を見せたい)場合はDonut、それ以外(ランキング表示)はBarH。 */
function pickT2Component(series: DimensionSeries[]): 'donut' | 'barH' {
  return series.length > 0 && series.length <= 6 ? 'donut' : 'barH';
}

/** container に BiResult を描画する。返り値の関数で(ECharts系のみ)後始末できる。 */
export function renderBiResult(
  container: HTMLElement,
  biResult: BiResult,
  onDrill: (routerQuery: string) => void,
): () => void {
  injectBiChatStyles();
  container.className = 'exh-bi-panel';
  container.innerHTML = '';

  const chartHost = document.createElement('div');
  chartHost.className = 'exh-bi-chart-host';
  container.appendChild(chartHost);

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
      chartHost.classList.add('exh-bi-chart-tall');
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

  return () => dispose?.();
}
