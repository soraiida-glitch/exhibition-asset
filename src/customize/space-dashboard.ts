import { THEME } from './theme';

/**
 * この空間ポータル用の「共有ウィジェット行」は、以前はここに旧ダッシュボード(案件総額/
 * 成約金額のKPI・フェーズ別パイプライン・営業ランキングTOP3)を差し込む役目も持っていたが、
 * その内容は src/customize/dashboard.ts(RELVA BI 追加要件定義書 §5、6枚の分析ダッシュボード
 * ＋ピン留めカード)に完全に置き換わったため、initSpaceDashboard() 自体は廃止した(重複表示の
 * ため)。この行(getOrCreateSpaceWidgetRow)自体は dashboard.ts / デイリーアドバイスカードが
 * 引き続き使う共有コンテナなので残す。
 */
function injectSpaceDashboardStyles(): void {
  if (document.getElementById('exh-space-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-space-dashboard-styles';
  style.textContent = `
/* The row sits in the normal page flow (inserted right after the "お知らせ" card) rather than
   floating fixed to the viewport, so its contents scroll away with the page instead of staying
   pinned on screen and overlapping the announcements area above them. */
#exh-space-widget-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px; margin: 16px 16px 0;
  max-width: 100%; box-sizing: border-box; font-family: ${THEME.font}; }
`;
  document.head.appendChild(style);
}

/** Finds the space's native "お知らせ" (announcements) card so the shared widget row can be
 * inserted right after it. kintone exposes no official hook for this — we can't inspect the live
 * DOM from here, so this is a best-effort text search with a heuristic walk up to the enclosing
 * card, falling back to appending at the end of <body> (guaranteed not to land above the banner)
 * if it doesn't match. */
function findAnnouncementsCard(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('div, section, h1, h2, h3, span')).find(
    (el) => el.textContent?.trim() === 'お知らせ' && el.children.length === 0,
  );
  if (!heading) return null;

  let node: HTMLElement = heading;
  for (let i = 0; i < 6 && node.parentElement; i++) {
    node = node.parentElement;
    if (node.clientHeight > 100) return node;
  }
  return null;
}

/** Shared row for space-portal widgets (the BI dashboard, the daily-advice card) so they sit side
 * by side in the page's normal flow instead of each floating independently. Idempotent: whichever
 * widget initializes first creates the row, the other just appends into it. */
export function getOrCreateSpaceWidgetRow(): HTMLElement {
  const existing = document.getElementById('exh-space-widget-row');
  if (existing) return existing;

  injectSpaceDashboardStyles();

  const row = document.createElement('div');
  row.id = 'exh-space-widget-row';

  const announcementsCard = findAnnouncementsCard();
  if (announcementsCard?.parentElement) {
    announcementsCard.parentElement.insertBefore(row, announcementsCard.nextSibling);
  } else {
    document.body.appendChild(row);
  }
  return row;
}
