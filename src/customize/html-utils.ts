/**
 * 純粋なHTMLエスケープのみを切り出したモジュール。chat.ts は `kintone.events.on(...)` を
 * トップレベルで呼ぶ副作用付きモジュールのため、そこから import すると kintone が存在しない
 * 文脈(dev/playground など)でクラッシュする。RELVA BI のチャートコンポーネント
 * (src/customize/charts/*)はプレイグラウンドでも読み込まれるため、副作用のないここから
 * import する。chat.ts 自身は互換のためこの関数を re-export し続ける。
 */
export function escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
