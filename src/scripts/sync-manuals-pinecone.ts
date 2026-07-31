import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env';

const MANUALS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  '_manuals',
);
const MANUAL_NAMESPACE = 'exhibition-manuals';
const EMBED_BATCH_SIZE = 10;
const MAX_CHUNK_CHARS = 1200;

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Splits on blank lines (paragraph/Q&A-entry boundaries in these manuals) and packs
// consecutive paragraphs together up to MAX_CHUNK_CHARS, so a chunk never cuts a single
// paragraph or FAQ entry in half.
function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function embedBatch(openaiApiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    throw new Error(`embeddings request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return body.data.map((d) => d.embedding);
}

async function pineconeUpsert(
  pineconeHost: string,
  pineconeApiKey: string,
  namespace: string,
  vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>,
): Promise<void> {
  const res = await fetch(`https://${pineconeHost}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Api-Key': pineconeApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors, namespace }),
  });
  if (!res.ok) {
    throw new Error(`Pinecone upsert failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const env = loadEnv();
  const pineconeHost = requireEnvValue('PINECONE_HOST', env.pineconeHost);
  const pineconeApiKey = requireEnvValue('PINECONE_API_KEY', env.pineconeApiKey);
  const openaiApiKey = requireEnvValue('OPENAI_API_KEY', env.openaiApiKey);

  const files = fs.readdirSync(MANUALS_DIR).filter((f) => f.endsWith('.txt'));
  console.log(`Found ${files.length} manual files in ${MANUALS_DIR}`);

  for (const file of files) {
    const fileName = file.replace(/\.txt$/, '');
    const text = fs.readFileSync(path.join(MANUALS_DIR, file), 'utf-8');
    const chunks = chunkText(text);
    console.log(`${fileName}: ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      try {
        const embeddings = await embedBatch(openaiApiKey, batch);
        // Pinecone requires ASCII-only vector IDs, so the (Japanese) fileName can't be used
        // directly — the leading numeric prefix already in every manual's filename (01_, 02_, ...)
        // is used instead, with the full fileName kept in metadata for display/citation.
        const idPrefix =
          fileName.match(/^\d+/)?.[0] ||
          Array.from(fileName)
            .filter((c) => c.charCodeAt(0) < 128)
            .join('');
        const vectors = batch.map((chunk, idx) => ({
          id: `manual_${idPrefix}_${i + idx}`,
          values: embeddings[idx],
          metadata: {
            source: 'manual',
            fileName,
            chunkIndex: i + idx,
            text: chunk,
          },
        }));
        await pineconeUpsert(pineconeHost, pineconeApiKey, MANUAL_NAMESPACE, vectors);
        console.log(`   synced ${Math.min(i + EMBED_BATCH_SIZE, chunks.length)}/${chunks.length}`);
      } catch (err) {
        console.error(`   batch starting at ${i} failed, skipping:`, err);
        await sleep(2000);
      }

      await sleep(200);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
