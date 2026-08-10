import fs from 'node:fs';

interface ZipEntry {
  filename: string;
  compression: number;
  lastModTime: number;
  lastModDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

/**
 * Minimal ZIP reader for a .pptx (a plain, STORE-method ZIP) — ported from Relava's
 * `scripts/generate_pptx_code_node.js`, which was itself validated against the real
 * template file this project also uses (byte-identical, confirmed via sha256).
 * Build-time only (Node.js `fs`/`Buffer`); never runs inside n8n's Code node sandbox.
 */
function parseZip(buf: Buffer): ZipEntry[] {
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('EOCD not found');

  const numEntries = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const entries: ZipEntry[] = [];
  let cdPos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50) throw new Error('Bad CD sig');
    const compression = buf.readUInt16LE(cdPos + 10);
    const lastModTime = buf.readUInt16LE(cdPos + 12);
    const lastModDate = buf.readUInt16LE(cdPos + 14);
    const crc32 = buf.readUInt32LE(cdPos + 16);
    const compressedSize = buf.readUInt32LE(cdPos + 20);
    const uncompressedSize = buf.readUInt32LE(cdPos + 24);
    const fnLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localOffset = buf.readUInt32LE(cdPos + 42);
    const filename = buf.subarray(cdPos + 46, cdPos + 46 + fnLen).toString('utf8');
    cdPos += 46 + fnLen + extraLen + commentLen;

    if (filename.endsWith('/')) continue;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local sig for ${filename}`);
    const localFnLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFnLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compressedSize);

    entries.push({ filename, compression, lastModTime, lastModDate, crc32, compressedSize, uncompressedSize, data });
  }
  return entries;
}

/**
 * Generates the n8n Code node JavaScript source for "Build PPTX from Template". The output
 * embeds the full template as base64 plus a pure-JS ZIP/CRC32 writer (n8n's Code node sandbox
 * has no `require()`, so no zip library is available at runtime) and expects the calling
 * workflow to supply a flat `placeholders` object (via `$json.placeholders`) — unlike Relava's
 * own generator, this one does not hardcode any business/slide content, since exhibition-asset
 * needs proposals that vary per deal (see roleplay-workflow.ts's persona generation for the same
 * "AI fills in the specifics, this file only assembles them" split).
 */
export function buildPptxCodeNodeSource(templatePath: string): string {
  const templateBuf = fs.readFileSync(templatePath);
  const entries = parseZip(templateBuf);

  const slideFileNames = new Set(
    entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.filename)).map((e) => e.filename),
  );

  const staticFiles: Array<{
    filename: string;
    compression: number;
    lastModTime: number;
    lastModDate: number;
    crc32: number;
    uncompressedSize: number;
    b64: string;
  }> = [];
  const slideXmls: Array<{ filename: string; text: string }> = [];

  for (const e of entries) {
    if (slideFileNames.has(e.filename)) {
      slideXmls.push({ filename: e.filename, text: e.data.toString('utf8') });
    } else {
      staticFiles.push({
        filename: e.filename,
        compression: e.compression,
        lastModTime: e.lastModTime,
        lastModDate: e.lastModDate,
        crc32: e.crc32,
        uncompressedSize: e.uncompressedSize,
        b64: e.data.toString('base64'),
      });
    }
  }

  const lines: string[] = [];

  lines.push('// Static files (images, rels, masters, etc.) — pre-encoded as base64');
  lines.push('const STATIC_FILES = [');
  for (const f of staticFiles) {
    lines.push('  {');
    lines.push(`    filename: ${JSON.stringify(f.filename)},`);
    lines.push(`    b64: ${JSON.stringify(f.b64)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  lines.push('// Slide XMLs — stored as UTF-8 text; {{PLACEHOLDER}} tokens get replaced at runtime');
  lines.push('const SLIDE_TEMPLATES = {');
  for (const s of slideXmls) {
    lines.push(`  ${JSON.stringify(s.filename)}: ${JSON.stringify(s.text)},`);
  }
  lines.push('};');
  lines.push('');

  lines.push('const CRC_TABLE = (() => {');
  lines.push('  const t = new Uint32Array(256);');
  lines.push('  for (let i = 0; i < 256; i++) {');
  lines.push('    let c = i;');
  lines.push('    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);');
  lines.push('    t[i] = c;');
  lines.push('  }');
  lines.push('  return t;');
  lines.push('})();');
  lines.push('');
  lines.push('function crc32(buf) {');
  lines.push('  let c = 0xFFFFFFFF;');
  lines.push('  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);');
  lines.push('  return (c ^ 0xFFFFFFFF) >>> 0;');
  lines.push('}');
  lines.push('');

  lines.push('function b64ToBuffer(b64) {');
  lines.push('  const bin = atob(b64);');
  lines.push('  const buf = Buffer.alloc(bin.length);');
  lines.push('  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);');
  lines.push('  return buf;');
  lines.push('}');
  lines.push('');

  lines.push('// Pure-JS ZIP builder (STORE method only)');
  lines.push('function buildZip(fileEntries) {');
  lines.push('  const parts = [];');
  lines.push('  const cdEntries = [];');
  lines.push('  let offset = 0;');
  lines.push('');
  lines.push('  for (const { filename, data } of fileEntries) {');
  lines.push("    const fnBuf  = Buffer.from(filename, 'utf8');");
  lines.push('    const crc    = crc32(data);');
  lines.push('    const size   = data.length;');
  lines.push('    const lh = Buffer.alloc(30 + fnBuf.length);');
  lines.push('    lh.writeUInt32LE(0x04034b50, 0);');
  lines.push('    lh.writeUInt16LE(20, 4);');
  lines.push('    lh.writeUInt16LE(0, 6);');
  lines.push('    lh.writeUInt16LE(0, 8);');
  lines.push('    lh.writeUInt16LE(0, 10);');
  lines.push('    lh.writeUInt16LE(0, 12);');
  lines.push('    lh.writeUInt32LE(crc, 14);');
  lines.push('    lh.writeUInt32LE(size, 18);');
  lines.push('    lh.writeUInt32LE(size, 22);');
  lines.push('    lh.writeUInt16LE(fnBuf.length, 26);');
  lines.push('    lh.writeUInt16LE(0, 28);');
  lines.push('    fnBuf.copy(lh, 30);');
  lines.push('    parts.push(lh);');
  lines.push('    parts.push(data);');
  lines.push('    cdEntries.push({ fnBuf, crc, size, offset });');
  lines.push('    offset += lh.length + size;');
  lines.push('  }');
  lines.push('');
  lines.push('  const cdStart = offset;');
  lines.push('  for (const { fnBuf, crc, size, offset: lhOffset } of cdEntries) {');
  lines.push('    const cd = Buffer.alloc(46 + fnBuf.length);');
  lines.push('    cd.writeUInt32LE(0x02014b50, 0);');
  lines.push('    cd.writeUInt16LE(20, 4);');
  lines.push('    cd.writeUInt16LE(20, 6);');
  lines.push('    cd.writeUInt16LE(0, 8);');
  lines.push('    cd.writeUInt16LE(0, 10);');
  lines.push('    cd.writeUInt16LE(0, 12);');
  lines.push('    cd.writeUInt16LE(0, 14);');
  lines.push('    cd.writeUInt32LE(crc, 16);');
  lines.push('    cd.writeUInt32LE(size, 20);');
  lines.push('    cd.writeUInt32LE(size, 24);');
  lines.push('    cd.writeUInt16LE(fnBuf.length, 28);');
  lines.push('    cd.writeUInt16LE(0, 30);');
  lines.push('    cd.writeUInt16LE(0, 32);');
  lines.push('    cd.writeUInt16LE(0, 34);');
  lines.push('    cd.writeUInt16LE(0, 36);');
  lines.push('    cd.writeUInt32LE(0, 38);');
  lines.push('    cd.writeUInt32LE(lhOffset, 42);');
  lines.push('    fnBuf.copy(cd, 46);');
  lines.push('    parts.push(cd);');
  lines.push('    offset += cd.length;');
  lines.push('  }');
  lines.push('  const cdSize = offset - cdStart;');
  lines.push('');
  lines.push('  const eocd = Buffer.alloc(22);');
  lines.push('  eocd.writeUInt32LE(0x06054b50, 0);');
  lines.push('  eocd.writeUInt16LE(0, 4);');
  lines.push('  eocd.writeUInt16LE(0, 6);');
  lines.push('  eocd.writeUInt16LE(cdEntries.length, 8);');
  lines.push('  eocd.writeUInt16LE(cdEntries.length, 10);');
  lines.push('  eocd.writeUInt32LE(cdSize, 12);');
  lines.push('  eocd.writeUInt32LE(cdStart, 16);');
  lines.push('  eocd.writeUInt16LE(0, 20);');
  lines.push('  parts.push(eocd);');
  lines.push('');
  lines.push('  return Buffer.concat(parts);');
  lines.push('}');
  lines.push('');

  lines.push('function xe(str) {');
  lines.push("  return String(str == null ? '' : str)");
  lines.push("    .replace(/&/g, '&amp;')");
  lines.push("    .replace(/</g, '&lt;')");
  lines.push("    .replace(/>/g, '&gt;')");
  lines.push('    .replace(/"/g, \'&quot;\')');
  lines.push("    .replace(/'/g, '&apos;');");
  lines.push('}');
  lines.push('');

  lines.push('// Merge adjacent <a:r> runs that together contain a split placeholder — PowerPoint');
  lines.push('// sometimes splits one {{TOKEN}} across 2+ runs when the text has mixed formatting.');
  lines.push('function mergeRuns(xml) {');
  lines.push('  const RUN_PAIR = /(<a:r>[\\s\\S]*?<a:t>)([^<]*)<\\/a:t><\\/a:r>(<a:r>[\\s\\S]*?<a:t>)([^<]*)<\\/a:t><\\/a:r>/g;');
  lines.push('  for (let pass = 0; pass < 10; pass++) {');
  lines.push('    const prev = xml;');
  lines.push('    xml = xml.replace(RUN_PAIR, (_, o1, t1, _o2, t2) => `${o1}${t1}${t2}</a:t></a:r>`);');
  lines.push('    if (xml === prev) break;');
  lines.push('  }');
  lines.push('  return xml;');
  lines.push('}');
  lines.push('');

  lines.push('// ---- Main: expects $json.placeholders (flat {TOKEN: value} object) ----');
  lines.push('const inp = $input.first().json;');
  lines.push("const placeholders = inp.placeholders || {};");
  lines.push("const customerName = inp.customerName || '';");
  lines.push("const dealName     = inp.dealName     || '';");
  lines.push("const today        = inp.today        || '';");
  lines.push('');
  lines.push('const staticMap = new Map();');
  lines.push('for (const f of STATIC_FILES) {');
  lines.push('  staticMap.set(f.filename, b64ToBuffer(f.b64));');
  lines.push('}');
  lines.push('');
  lines.push('const slideMap = new Map();');
  lines.push('for (const [filename, template] of Object.entries(SLIDE_TEMPLATES)) {');
  lines.push('  let xml = mergeRuns(template);');
  lines.push('  for (const [key, val] of Object.entries(placeholders)) {');
  lines.push('    xml = xml.split(`{{${key}}}`).join(xe(val));');
  lines.push('  }');
  lines.push("  slideMap.set(filename, Buffer.from(xml, 'utf8'));");
  lines.push('}');
  lines.push('');

  lines.push('const ORIGINAL_ORDER = [');
  for (const e of entries) {
    lines.push(`  ${JSON.stringify(e.filename)},`);
  }
  lines.push('];');
  lines.push('');
  lines.push('const zipEntries = [];');
  lines.push('for (const fn of ORIGINAL_ORDER) {');
  lines.push('  if (slideMap.has(fn)) zipEntries.push({ filename: fn, data: slideMap.get(fn) });');
  lines.push('  else if (staticMap.has(fn)) zipEntries.push({ filename: fn, data: staticMap.get(fn) });');
  lines.push('}');
  lines.push('');
  lines.push('const pptxBuf  = buildZip(zipEntries);');
  lines.push("const base64   = pptxBuf.toString('base64');");
  lines.push("const safeName = customerName.replace(/[^\\u30A0-\\u30FF\\u3040-\\u309F\\u4E00-\\u9FFF\\w]/g, '_').trim() || 'proposal';");
  // Seconds-granular timestamp, not just the day-level `today` string — two proposals generated
  // for the same customer on the same day previously produced the same filename, so Box's upload
  // 409'd on the second one and (see Upload to Box / Resolve Box File ID below) the stale first
  // file's link was returned instead of the freshly regenerated content.
  lines.push("const uniqueStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);");
  lines.push("const fileName = `提案書_${safeName}_${uniqueStamp}.pptx`;");
  lines.push('');
  lines.push('return [{ json: { base64, fileName, customerName, dealName } }];');

  return lines.join('\n');
}
