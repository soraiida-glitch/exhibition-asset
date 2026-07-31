import { escHtml, STATUS_PILL_CLASS } from './chat';
import { THEME } from './theme';

const RS_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  assigneeAppId: __ASSIGNEE_APP_ID__,
};

interface OpportunityRecordFields {
  deal_name?: { value?: string };
  account?: { value?: string };
  amount?: { value?: string };
  stage?: { value?: string };
  close_date?: { value?: string };
  owner?: { value?: string };
}

function injectRecordSummaryStyles(): void {
  if (document.getElementById('exh-rs-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-rs-styles';
  const t = THEME;
  style.textContent = `
.exh-rs-card { display: block; width: 100%; box-sizing: border-box; margin-top: 10px;
  background: linear-gradient(120deg, ${t.cloud} 0%, #fff 60%); border: 1px solid ${t.mistLine};
  border-radius: 14px; padding: 16px 18px; box-shadow: 0 10px 26px -18px rgba(20,40,60,.3); }
/* Last-resort fallback when no reliable in-flow insertion point can be found — floats the card so
   it is at least visible somewhere, rather than silently missing. */
.exh-rs-card.exh-rs-card-fixed { position: fixed; top: 80px; left: 16px; width: 340px;
  z-index: 9997; }
.exh-rs-company { font-size: 13px; font-weight: 700; color: ${t.soraDeep}; }
.exh-rs-deal-name { font-size: 19px; font-weight: 800; color: ${t.ink}; margin-top: 2px; }
.exh-rs-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px; margin-top: 14px; }
.exh-rs-kpi-label { font-size: 11px; font-weight: 700; color: #5a6b7a; }
.exh-rs-kpi-value { font-size: 17px; font-weight: 800; color: ${t.ink}; margin-top: 3px;
  font-variant-numeric: tabular-nums; }
.exh-rs-kpi-value.exh-rs-amount { color: ${t.soraDeep}; }
`;
  document.head.appendChild(style);
}

async function resolveOwnerDisplayName(ownerRaw: string): Promise<string> {
  if (!ownerRaw) return ownerRaw;
  try {
    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(RS_CONFIG.assigneeAppId),
      fields: ['assignee_name'],
      query: `assignee_code = "${ownerRaw.replace(/"/g, '')}" limit 1`,
    })) as { records: Array<{ assignee_name?: { value?: string } }> };
    return result.records[0]?.assignee_name?.value || ownerRaw;
  } catch {
    return ownerRaw;
  }
}

function formatYen(amount: number): string {
  return '¥' + Math.round(amount / 10000).toLocaleString('ja-JP') + '万';
}

interface InsertionTarget {
  container: HTMLElement;
  mode: 'prepend' | 'body-fixed';
  label: string;
}

/** Tries a chain of candidate insertion points, from most to least ideal, logging which one it
 * actually used — several "confirmed" kintone class names have turned out not to exist in this
 * particular rendering, so this no longer trusts any single guess. */
function findInsertionTarget(): InsertionTarget {
  const layoutGaia = document.querySelector<HTMLElement>('#record-gaia .layout-gaia');
  if (layoutGaia) return { container: layoutGaia, mode: 'prepend', label: '#record-gaia .layout-gaia' };

  const recordGaia = document.getElementById('record-gaia');
  if (recordGaia) return { container: recordGaia, mode: 'prepend', label: '#record-gaia' };

  const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
  if (headerSpace) return { container: headerSpace, mode: 'prepend', label: 'getHeaderMenuSpaceElement()' };

  return { container: document.body, mode: 'body-fixed', label: 'document.body (fixed fallback)' };
}

// The caller must pass the record straight from the detail.show event object (event.record).
// kintone explicitly forbids calling kintone.app.record.get() while a record-show event handler
// is still being processed — it throws "You cannot call kintone.app.record.get() in handler or
// during processing a handler." — which is exactly the case here, so the event's own record data
// is used instead of fetching it again.
export function initRecordSummary(appId: string, eventRecord: unknown): void {
  try {
    if (appId !== RS_CONFIG.opportunityAppId) return;
    injectRecordSummaryStyles();
    // Rebuilt every time rather than guarded-and-skipped: kintone's detail view can navigate
    // between records (prev/next arrows, or back-then-into-a-different-record) without a full
    // page reload, re-firing app.record.detail.show for a new record while the old card element
    // is still sitting in the DOM — a skip-if-present guard would freeze it on the first record
    // ever viewed instead of refreshing for whichever record is actually showing now.
    document.getElementById('exh-rs-card')?.remove();

    const target = findInsertionTarget();
    console.log('[exh-rs] using insertion point:', target.label);

    const record = (eventRecord || {}) as OpportunityRecordFields & Record<string, { value?: unknown }>;
    const dealName = record.deal_name?.value || '';
    const account = record.account?.value || '(取引先未設定)';
    const amount = Number(record.amount?.value || 0);
    const stage = record.stage?.value || '';
    const closeDate = record.close_date?.value || '未設定';
    const ownerRaw = record.owner?.value || '未設定';

    const card = document.createElement('div');
    card.id = 'exh-rs-card';
    card.className = target.mode === 'body-fixed' ? 'exh-rs-card exh-rs-card-fixed' : 'exh-rs-card';
    const pillClass = STATUS_PILL_CLASS[stage] || 'exh-pill-neutral';
    card.innerHTML = `
      <div class="exh-rs-company">🏢 ${escHtml(account)}</div>
      <div class="exh-rs-deal-name">${escHtml(dealName)}</div>
      <div class="exh-rs-kpi-row">
        <div><div class="exh-rs-kpi-label">金額</div><div class="exh-rs-kpi-value exh-rs-amount">${escHtml(formatYen(amount))}</div></div>
        <div><div class="exh-rs-kpi-label">フェーズ</div><div class="exh-rs-kpi-value"><span class="exh-status-pill ${pillClass}">${escHtml(stage)}</span></div></div>
        <div><div class="exh-rs-kpi-label">クロージング予定</div><div class="exh-rs-kpi-value">${escHtml(closeDate)}</div></div>
        <div><div class="exh-rs-kpi-label">担当者</div><div class="exh-rs-kpi-value" id="exh-rs-owner">${escHtml(ownerRaw)}</div></div>
      </div>
    `;

    if (target.mode === 'prepend') {
      target.container.insertBefore(card, target.container.firstChild);
    } else {
      target.container.appendChild(card);
    }
    console.log('[exh-rs] card inserted');

    void resolveOwnerDisplayName(ownerRaw).then((name) => {
      const el = document.getElementById('exh-rs-owner');
      if (el) el.textContent = name;
    });
  } catch (err) {
    console.error('[exh-rs] failed:', err);
  }
}
