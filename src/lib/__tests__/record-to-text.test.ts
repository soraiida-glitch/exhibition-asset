import { describe, expect, it } from 'vitest';
import { recordToText, recordToTextEmbeddable } from '../record-to-text';

describe('recordToText', () => {
  it('formats an account record, omitting empty fields', () => {
    const text = recordToText('取引先', {
      company_name: { value: 'テック商事' },
      industry: { value: 'IT・ソフトウェア' },
      contact_name: { value: '' },
      phone: { value: '' },
      email: { value: '' },
      status: { value: '見込み' },
      memo: { value: '' },
    });
    expect(text).toBe('会社名: テック商事 | 業種: IT・ソフトウェア | ステータス: 見込み');
  });

  it('formats an opportunity record and only appends 円 when amount is present', () => {
    const withAmount = recordToText('案件', {
      deal_name: { value: '新規契約' },
      account: { value: 'テック商事' },
      amount: { type: 'NUMBER', value: '500000' },
      stage: { value: '交渉中' },
    });
    expect(withAmount).toContain('金額: 500000円');

    const withoutAmount = recordToText('案件', {
      deal_name: { value: '新規契約' },
      amount: { type: 'NUMBER', value: undefined },
    });
    expect(withoutAmount).not.toContain('円');
  });

  it('formats a lead record', () => {
    const text = recordToText('リード', {
      lead_name: { value: '山田太郎' },
      company_name: { value: 'サンプル商事' },
      source: { value: '名刺' },
    });
    expect(text).toBe('氏名: 山田太郎 | 会社名: サンプル商事 | 流入経路: 名刺');
  });

  it('falls back to a generic key: value dump for unknown app names', () => {
    const text = recordToText('不明なアプリ', {
      foo: { value: 'bar' },
    });
    expect(text).toBe('foo: bar');
  });

  it('is self-contained so its stringified source can run standalone in an n8n Code node', () => {
    const source = recordToText.toString();
    expect(source).not.toContain('require(');
    expect(source).not.toContain('import ');
    expect(source.startsWith('function recordToText')).toBe(true);
  });

  it('recordToTextEmbeddable() actually executes standalone, isolated from any build-tool helpers', () => {
    // Regression test: esbuild (via tsx) injects a `__name(fn, "fn")` call for the nested `val`
    // function when stringified, which throws "__name is not defined" if pasted verbatim into an
    // isolated context (like an n8n Code node) — this caught that exact bug once already.
    const embeddable = recordToTextEmbeddable();
    const isolatedFn = new Function(`${embeddable}\nreturn recordToText(...arguments);`);
    const text = isolatedFn('取引先', { company_name: { value: 'テック商事' } });
    expect(text).toBe('会社名: テック商事');
  });
});
