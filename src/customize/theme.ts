/**
 * Shared color tokens for the exhibition-booth UI (chat widget, roleplay/meeting-log/
 * sales-scoring/proposal panels). Single source of truth so a color change doesn't require
 * hunting through 5 separate injectXStyles() functions that used to each hardcode their own
 * unrelated accent color.
 */
export const THEME = {
  sora: '#0098bb',
  soraDeep: '#00728e',
  hinode: '#ff7a45',
  sun: '#ffc93c',
  ink: '#14233a',
  cloud: '#f5fbfc',
  mist: '#d8ecf0',
  mistLine: '#c3e0e6',
  // 本文用: 丸みの強いデフォルトの和文フォントより角のあるゴシック体にして、少し引き締まった
  // 印象にする(ユーザーフィードバック: 「フォントがかわいい感じ」)。
  font: "'Zen Kaku Gothic New', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', sans-serif",
  // KPI・グラフの数値専用: 幾何学的で先進的な印象の欧文フォント(和文はfontにフォールバック)。
  fontDisplay: "'Space Grotesk', 'Zen Kaku Gothic New', 'Hiragino Kaku Gothic ProN', sans-serif",
} as const;

/** Google Fontsの読み込み(冪等・複数箇所から呼んでも1回しか追加しない)。kintoneの
 * カスタマイズJSは通常のブラウザページとして動くため(Artifactsのような制限CSPは無い)、
 * 外部フォントの読み込みは問題なく動作する。 */
export function injectFontStyles(): void {
  if (document.getElementById('exh-font-styles')) return;

  const preconnect1 = document.createElement('link');
  preconnect1.rel = 'preconnect';
  preconnect1.href = 'https://fonts.googleapis.com';
  const preconnect2 = document.createElement('link');
  preconnect2.rel = 'preconnect';
  preconnect2.href = 'https://fonts.gstatic.com';
  preconnect2.crossOrigin = 'anonymous';

  const stylesheet = document.createElement('link');
  stylesheet.id = 'exh-font-styles';
  stylesheet.rel = 'stylesheet';
  stylesheet.href =
    'https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Space+Grotesk:wght@500;600;700&display=swap';

  document.head.appendChild(preconnect1);
  document.head.appendChild(preconnect2);
  document.head.appendChild(stylesheet);
}
