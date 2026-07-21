export interface KintoneFieldValue {
  type?: string;
  value?: unknown;
}

export type KintoneRecordFields = Record<string, KintoneFieldValue | undefined>;

/**
 * Converts a kintone record into an embeddable text blob, per exhibition-asset's actual field
 * codes. Self-contained on purpose (no imports, no closures) — this function's source is embedded
 * verbatim into n8n Code nodes via `recordToText.toString()`, so it must run standalone there too.
 * Relava's equivalent logic was copy-pasted into 3 separate files and drifted out of sync; this is
 * the single source of truth used by both the n8n workflows and the Node-side bulk sync script.
 */
export function recordToText(appName: string, record: KintoneRecordFields): string {
  function val(f: KintoneFieldValue | undefined): string {
    if (!f) return '';
    if (f.type === 'NUMBER') return f.value != null ? String(f.value) : '';
    return typeof f.value === 'string' ? f.value : '';
  }

  let parts: string[];
  if (appName === '取引先') {
    parts = [
      '会社名: ' + val(record.company_name),
      '業種: ' + val(record.industry),
      '担当者: ' + val(record.contact_name),
      '電話: ' + val(record.phone),
      'メール: ' + val(record.email),
      'ステータス: ' + val(record.status),
      'メモ: ' + val(record.memo),
    ];
  } else if (appName === '案件') {
    const amount = val(record.amount);
    parts = [
      '案件名: ' + val(record.deal_name),
      '取引先: ' + val(record.account),
      '金額: ' + (amount ? amount + '円' : ''),
      'フェーズ: ' + val(record.stage),
      'クロージング予定日: ' + val(record.close_date),
      '担当者: ' + val(record.owner),
      '概要: ' + val(record.description),
      '顧客の課題: ' + val(record.customer_issue),
      '商談メモ: ' + val(record.meeting_notes),
    ];
  } else if (appName === 'リード') {
    parts = [
      '氏名: ' + val(record.lead_name),
      '会社名: ' + val(record.company_name),
      '電話: ' + val(record.phone),
      'メール: ' + val(record.email),
      '流入経路: ' + val(record.source),
      'ステータス: ' + val(record.status),
      'メモ: ' + val(record.memo),
    ];
  } else {
    return Object.entries(record)
      .map(([k, f]) => k + ': ' + (f && f.value != null ? String(f.value) : ''))
      .join(' | ');
  }

  return parts.filter((s) => !s.endsWith(': ')).join(' | ');
}

/**
 * `recordToText.toString()` alone isn't safe to paste into an n8n Code node as-is: esbuild (via
 * tsx) injects a `__name(fn, "fn")` call to preserve the nested `val` function's `.name` property,
 * and that helper doesn't exist in the isolated Code node execution context — it throws
 * "__name is not defined" at runtime. Prepending a no-op shim makes the embedded source safe
 * regardless of which build tool transpiled this file.
 */
export function recordToTextEmbeddable(): string {
  return `function __name(fn) { return fn; }\n${recordToText.toString()}`;
}
