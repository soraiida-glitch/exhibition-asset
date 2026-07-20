import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadEnv } from '../config/env';

/** Resolve the actual .js entry point rather than the `kintone-dts-gen` shell shim, avoiding
 *  Windows .cmd/shell-escaping issues entirely (execFileSync + node, no shell involved). */
const DTS_GEN_BIN = fileURLToPath(import.meta.resolve('@kintone/dts-gen/dist/index.js'));

const APP_IDS_PATH = path.resolve(process.cwd(), 'app-ids.json');
const OUTPUT_DIR = path.resolve(process.cwd(), 'types/generated');

interface AppIds {
  account: number;
  opportunity: number;
  lead: number;
}

const TARGETS: Array<{ key: keyof AppIds; typeName: string; namespace: string; file: string }> = [
  { key: 'account', typeName: 'ExhibitionAccountFields', namespace: 'exhibition.account', file: 'account.d.ts' },
  {
    key: 'opportunity',
    typeName: 'ExhibitionOpportunityFields',
    namespace: 'exhibition.opportunity',
    file: 'opportunity.d.ts',
  },
  { key: 'lead', typeName: 'ExhibitionLeadFields', namespace: 'exhibition.lead', file: 'lead.d.ts' },
];

function main() {
  const env = loadEnv();

  if (!fs.existsSync(APP_IDS_PATH)) {
    throw new Error(`${APP_IDS_PATH} not found. Run "npm run setup:apps" first.`);
  }
  const appIds: AppIds = JSON.parse(fs.readFileSync(APP_IDS_PATH, 'utf-8'));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const baseUrl = `https://${env.kintoneSubdomain}.cybozu.com`;

  for (const target of TARGETS) {
    const appId = appIds[target.key];
    const outputPath = path.join(OUTPUT_DIR, target.file);
    console.log(`Generating types for app ${appId} (${target.key}) -> ${outputPath}`);

    execFileSync(
      process.execPath,
      [
        DTS_GEN_BIN,
        '--base-url',
        baseUrl,
        '--username',
        env.kintoneAdminUser,
        '--password',
        env.kintoneAdminPassword,
        '--app-id',
        String(appId),
        '--type-name',
        target.typeName,
        '--namespace',
        target.namespace,
        '-o',
        outputPath,
      ],
      { stdio: 'inherit' },
    );
  }

  console.log(`Done. Generated types in ${OUTPUT_DIR}`);
}

main();
