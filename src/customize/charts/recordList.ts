import { escHtml } from '../html-utils';
import { THEME } from '../theme';
import type { PayloadFor } from '../../semantic/templates';

/** T8(条件抽出リスト)。要件定義書通りHTML表のまま(ECharts化しない)。 */
export function injectRecordListStyles(): void {
  if (document.getElementById('exh-bi-record-list-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-record-list-styles';
  style.textContent = `
.exh-bi-record-list-wrap { overflow-x: auto; border: 1px solid ${THEME.mistLine}; border-radius: 12px; }
.exh-bi-record-list { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.exh-bi-record-list th { text-align: left; background: ${THEME.cloud}; color: #5a6b7a; font-weight: 700;
  padding: 8px 10px; border-bottom: 1px solid ${THEME.mistLine}; white-space: nowrap; }
.exh-bi-record-list td { padding: 8px 10px; border-bottom: 1px solid ${THEME.mistLine}; color: ${THEME.ink}; white-space: nowrap; }
.exh-bi-record-list tr:last-child td { border-bottom: none; }
.exh-bi-record-list a { color: ${THEME.soraDeep}; font-weight: 700; text-decoration: none; }
.exh-bi-record-list a:hover { text-decoration: underline; }
`;
  document.head.appendChild(style);
}

const COLUMN_LABELS: Record<string, string> = {
  deal_name: '案件名',
  account: '取引先',
  amount: '金額(円)',
  stage: 'フェーズ',
  owner: '担当者',
  close_date: 'クロージング予定日',
  // entity: 'lead' の T8(例: 対応待ちリード一覧)向け。
  lead_name: '氏名',
  company_name: '会社名',
  source: '流入経路',
  status: 'ステータス',
};

export function renderRecordList(container: HTMLElement, payload: PayloadFor<'T8'>, recordUrlBase?: string): void {
  injectRecordListStyles();

  const urlField = payload.recordUrlField;
  const head = payload.columns.map((c) => `<th>${escHtml(COLUMN_LABELS[c] ?? c)}</th>`).join('');
  const body = payload.records
    .map((row) => {
      const cells = payload.columns
        .map((c) => {
          const value = row[c] ?? '';
          if (c === urlField && recordUrlBase && row.$id) {
            return `<td><a href="${escHtml(`${recordUrlBase}?record=${row.$id}`)}" target="_blank" rel="noopener">${escHtml(value)}</a></td>`;
          }
          return `<td>${escHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  container.innerHTML = `<div class="exh-bi-record-list-wrap"><table class="exh-bi-record-list"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
