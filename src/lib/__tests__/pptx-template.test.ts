import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPptxCodeNodeSource } from '../pptx-template';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'templates', 'proposal_template.pptx');

describe('buildPptxCodeNodeSource', () => {
  it('parses the real template into 9 slide templates and a static-file set', () => {
    const source = buildPptxCodeNodeSource(TEMPLATE_PATH);
    const slideMatches = source.match(/"ppt\/slides\/slide\d+\.xml":/g);
    expect(slideMatches).toHaveLength(9);
    expect(source).toContain('const STATIC_FILES = [');
  });

  it('produces source with no require()/import (must run standalone in an n8n Code node)', () => {
    const source = buildPptxCodeNodeSource(TEMPLATE_PATH);
    expect(source).not.toContain('require(');
    expect(source).not.toContain('import ');
  });

  it('executes standalone and returns a valid-looking pptx base64 payload', () => {
    const source = buildPptxCodeNodeSource(TEMPLATE_PATH);
    const placeholderTokens = new Set<string>();
    const re = /\{\{([A-Z0-9_]+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) placeholderTokens.add(m[1]);

    const fn = new Function('$input', 'Buffer', 'atob', source);
    const placeholders: Record<string, string> = {};
    for (const token of placeholderTokens) placeholders[token] = `[TEST:${token}]`;

    const result = fn(
      {
        first: () => ({
          json: { placeholders, customerName: 'テスト株式会社', dealName: 'テスト案件', today: '2026年7月21日' },
        }),
      },
      Buffer,
      (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
    ) as Array<{ json: { base64: string; fileName: string } }>;

    expect(result[0].json.base64.length).toBeGreaterThan(100_000);
    expect(result[0].json.fileName).toBe('提案書_テスト株式会社_2026年7月21日.pptx');

    // A valid ZIP's local file header signature, confirming buildZip() assembled real ZIP bytes.
    const pptxBuffer = Buffer.from(result[0].json.base64, 'base64');
    expect(pptxBuffer.readUInt32LE(0)).toBe(0x04034b50);
  });
});
