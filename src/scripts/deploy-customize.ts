import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnv, requireAppId } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';

// vite's package.json doesn't expose "bin" via its "exports" map, so import.meta.resolve()
// can't find it — resolve the well-known node_modules path directly instead.
const VITE_BIN = path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js');
const BUNDLE_PATH = path.resolve(process.cwd(), 'dist/customize/chat.js');

async function main() {
  const env = loadEnv();

  console.log('Building chat.ts via vite ...');
  execFileSync(process.execPath, [VITE_BIN, 'build'], { stdio: 'inherit' });

  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf-8');

  const kintone = new KintoneAdminClient({
    subdomain: env.kintoneSubdomain,
    username: env.kintoneAdminUser,
    password: env.kintoneAdminPassword,
  });

  const targets: Array<{ label: string; appId: number }> = [
    { label: 'exhibition_取引先', appId: requireAppId(env, 'kintoneAppIdAccount') },
    { label: 'exhibition_案件', appId: requireAppId(env, 'kintoneAppIdOpportunity') },
    { label: 'exhibition_リード', appId: requireAppId(env, 'kintoneAppIdLead') },
  ];

  // A fileKey is consumed on first use — reusing the same fileKey across apps, or even twice
  // within one customize.json call (desktop.js + mobile.js), fails with GAIA_DC04 "duplicate
  // fileKey". Each attachment point needs its own fresh upload.
  for (const target of targets) {
    console.log(`Uploading chat.js for ${target.label} ...`);
    const desktopFileKey = await kintone.uploadFile('chat.js', bundle);
    const mobileFileKey = await kintone.uploadFile('chat.js', bundle);

    console.log(`Attaching chat.js to ${target.label} (app id ${target.appId}) ...`);
    await kintone.setCustomize(target.appId, {
      desktop: { js: [{ type: 'FILE', file: { fileKey: desktopFileKey } }], css: [] },
      mobile: { js: [{ type: 'FILE', file: { fileKey: mobileFileKey } }], css: [] },
      scope: 'ALL',
    });

    // updateAppCustomize only updates the pre-live settings, like addFormFields/deployApp for
    // fields — it must be deployed to actually reach end users.
    console.log(`Deploying customize settings for ${target.label} ...`);
    await kintone.deployApp(target.appId);
    await kintone.waitForDeploy(target.appId);
  }

  console.log('Done. chat.js is now attached to 取引先/案件/リード.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
