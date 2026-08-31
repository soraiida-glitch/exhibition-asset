import fs from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * `vite build` succeeding only proves the bundle is syntactically valid JS — it does NOT prove
 * the bundle actually *runs* without throwing in a real browser (no Node globals). This bit us
 * for real: echarts/zrender's internal `process.env.NODE_ENV` checks were never replaced in the
 * library-mode build, so the deployed chat.js threw "process is not defined" at load time on
 * every kintone page it was attached to — silently breaking the entire chat widget, not just the
 * new BI dashboard (discovered live, in the space portal, after deployment).
 *
 * This loads the built bundle into a real DOM (jsdom, so `innerHTML`/`getElementById` behave like
 * an actual browser — a hand-rolled DOM stub isn't enough to trust the result) with a minimal
 * kintone/fetch/ResizeObserver stub, fires a `space.portal.show` event, and fails loudly if
 * anything throws synchronously OR the async dashboard render rejects unhandled.
 */
export async function runCustomizeSmokeTest(bundlePath: string): Promise<void> {
  const code = fs.readFileSync(bundlePath, 'utf-8');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const { window } = dom;

  type Handler = (event: unknown) => unknown;
  const state: { handler: Handler | null } = { handler: null };
  (window as unknown as { kintone: unknown }).kintone = {
    events: {
      on: (_types: unknown, handler: Handler) => {
        state.handler = handler;
      },
    },
    app: { getId: () => null, getHeaderSpaceElement: () => null, record: {} },
    getLoginUser: () => ({ id: '1', name: 'smoke-test', code: 'smoke-test' }),
    api: async () => ({ records: [] }),
    proxy: async () => [200, '{}', {}],
  };
  (window as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, json: async () => ({}) });
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  // jsdom's canvas isn't installed (native dependency). ECharts' text-layout code (measureText)
  // expects a real-shaped TextMetrics back, not just "any callable" — a bare no-op stub throws
  // deep inside zrender's text measurement path, which isn't a real bug, just an under-stubbed
  // canvas. Same story for gradients: zrender's internal painting (e.g. funnel/heatmap default
  // visuals, first exercised once the BI dashboard started rendering all 5 chart types in one
  // smoke-test pass) calls createLinearGradient(...).addColorStop(...) — a bare no-op stub
  // returns undefined from createLinearGradient, and .addColorStop on undefined throws (again,
  // not a real bug — real browsers implement this fine; only jsdom's canvas stub doesn't).
  // Special-case both; every other 2D-context call is a safe no-op.
  const fakeGradient = { addColorStop: () => undefined };
  (window.HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () =>
    new Proxy(
      {
        measureText: () => ({ width: 10 }),
        createLinearGradient: () => fakeGradient,
        createRadialGradient: () => fakeGradient,
      },
      { get: (target, prop) => (prop in target ? (target as Record<string, unknown>)[String(prop)] : () => undefined) },
    );

  let caught: unknown;
  window.addEventListener('error', (e: ErrorEvent) => {
    caught = e.error ?? e.message;
  });

  window.eval(code);
  if (caught) throw new Error(`chat.js threw during load: ${String((caught as Error).stack ?? caught)}`);
  const handler = state.handler;
  if (!handler) {
    throw new Error('kintone.events.on was never called — the bundle did not reach its own setup code.');
  }

  const unhandled: unknown[] = [];
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    unhandled.push(e.reason);
  });

  await handler({ type: 'space.portal.show', spaceId: '2' });
  // let the async dashboard render()/fetch chain settle.
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (unhandled.length > 0) {
    throw new Error(`space.portal.show handler produced unhandled rejection(s): ${unhandled.map(String).join(', ')}`);
  }

  // RELVA BI 追加要件定義書 §5 — 6枚の分析ダッシュボード(+ピン留めカード)は space.portal.show
  // で必ずマウントされる(旧#exh-space-dashboardは廃止済み——このダッシュボードに完全に
  // 置き換わったため、二重表示にならないよう削除した)。この行が無いと、循環import・
  // チャート描画の例外でダッシュボードが静かに死んでいてもこのスモークテストは気付けない。
  const biDashboard = window.document.getElementById('exh-bi-dashboard');
  if (!biDashboard) {
    throw new Error('space.portal.show ran without throwing, but #exh-bi-dashboard was never inserted into the DOM.');
  }

  dom.window.close();
}

async function main() {
  const bundlePath = process.argv[2] ?? 'dist/customize/chat.js';
  console.log(`Smoke-testing ${bundlePath} in a headless jsdom browser ...`);
  await runCustomizeSmokeTest(bundlePath);
  console.log('OK: bundle loads and the space-portal dashboard mounts without throwing.');
}

// Only run as a script when invoked directly (`tsx src/scripts/smoke-test-customize.ts`) — this
// module is also imported by deploy-customize.ts as a pre-flight check before uploading.
if (process.argv[1] && process.argv[1].includes('smoke-test-customize')) {
  main().catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
