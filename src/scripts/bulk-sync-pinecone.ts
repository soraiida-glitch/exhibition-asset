import { loadEnv, requireAppId } from '../config/env';
import { recordToText } from '../lib/record-to-text';
import type { KintoneRecordFields } from '../lib/record-to-text';

const PAGE_LIMIT = 500;
const EMBED_BATCH_SIZE = 10;

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllRecords(
  baseUrl: string,
  appId: number,
  apiToken: string,
): Promise<Array<KintoneRecordFields & { $id: { value: string } }>> {
  const all: Array<KintoneRecordFields & { $id: { value: string } }> = [];
  let offset = 0;

  while (true) {
    const query = encodeURIComponent(`order by $id asc limit ${PAGE_LIMIT} offset ${offset}`);
    const res = await fetch(`${baseUrl}/k/v1/records.json?app=${appId}&query=${query}`, {
      headers: { 'X-Cybozu-API-Token': apiToken },
    });
    if (!res.ok) {
      throw new Error(`fetch failed for app ${appId}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { records: Array<KintoneRecordFields & { $id: { value: string } }> };
    all.push(...body.records);
    if (body.records.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return all;
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
  const baseUrl = `https://${env.kintoneSubdomain}.cybozu.com`;
  const pineconeHost = requireEnvValue('PINECONE_HOST', env.pineconeHost);
  const pineconeApiKey = requireEnvValue('PINECONE_API_KEY', env.pineconeApiKey);
  const namespace = env.pineconeNamespace || 'exhibition-kintone';
  const openaiApiKey = requireEnvValue('OPENAI_API_KEY', env.openaiApiKey);

  const apps = [
    {
      appName: '取引先',
      appId: requireAppId(env, 'kintoneAppIdAccount'),
      apiToken: requireEnvValue('KINTONE_API_TOKEN_ACCOUNT', env.kintoneApiTokenAccount),
    },
    {
      appName: '案件',
      appId: requireAppId(env, 'kintoneAppIdOpportunity'),
      apiToken: requireEnvValue('KINTONE_API_TOKEN_OPPORTUNITY', env.kintoneApiTokenOpportunity),
    },
    {
      appName: 'リード',
      appId: requireAppId(env, 'kintoneAppIdLead'),
      apiToken: requireEnvValue('KINTONE_API_TOKEN_LEAD', env.kintoneApiTokenLead),
    },
  ];

  for (const app of apps) {
    console.log(`Fetching ${app.appName} records ...`);
    const records = await fetchAllRecords(baseUrl, app.appId, app.apiToken);
    console.log(`   -> ${records.length} records`);

    for (let i = 0; i < records.length; i += EMBED_BATCH_SIZE) {
      const batch = records.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map((r) => `[kintone ${app.appName}] ` + recordToText(app.appName, r));

      try {
        const embeddings = await embedBatch(openaiApiKey, texts);
        const vectors = batch.map((record, idx) => {
          const recordId = record.$id.value;
          const metadata: Record<string, unknown> = {
            source: 'kintone',
            appName: app.appName,
            appId: String(app.appId),
            recordId,
            text: texts[idx],
          };
          const stage = record.stage;
          if (app.appName === '案件' && stage && typeof stage.value === 'string' && stage.value) {
            metadata.stage = stage.value;
          }
          return { id: `exhibition_${app.appId}_${recordId}`, values: embeddings[idx], metadata };
        });
        await pineconeUpsert(pineconeHost, pineconeApiKey, namespace, vectors);
        console.log(`   synced ${Math.min(i + EMBED_BATCH_SIZE, records.length)}/${records.length}`);
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
