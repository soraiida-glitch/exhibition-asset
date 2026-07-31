import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnv, requireAppId } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';

// vite's package.json doesn't expose "bin" via its "exports" map, so import.meta.resolve()
// can't find it — resolve the well-known node_modules path directly instead.
const VITE_BIN = path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js');
const BUNDLE_PATH = path.resolve(process.cwd(), 'dist/customize/chat.js');
const THEME_CSS_PATH = path.resolve(process.cwd(), 'src/customize/kintone-theme.css');

async function main() {
  const env = loadEnv();

  console.log('Building chat.ts via vite ...');
  execFileSync(process.execPath, [VITE_BIN, 'build'], { stdio: 'inherit' });

  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf-8');
  const themeCss = fs.readFileSync(THEME_CSS_PATH, 'utf-8');

  const kintone = new KintoneAdminClient({
    subdomain: env.kintoneSubdomain,
    username: env.kintoneAdminUser,
    password: env.kintoneAdminPassword,
  });

  // These 4 get both the chat.js widget and the visual-refresh CSS.
  const jsAndCssTargets: Array<{ label: string; appId: number }> = [
    { label: 'exhibition_取引先', appId: requireAppId(env, 'kintoneAppIdAccount') },
    { label: 'exhibition_案件', appId: requireAppId(env, 'kintoneAppIdOpportunity') },
    { label: 'exhibition_リード', appId: requireAppId(env, 'kintoneAppIdLead') },
    { label: 'exhibition_担当者', appId: requireAppId(env, 'kintoneAppIdAssignee') },
  ];

  // These have no interactive widget of their own, but get the same list/detail view CSS
  // refresh for visual consistency across all exhibition_* apps.
  const cssOnlyTargets: Array<{ label: string; appId: number }> = [
    { label: 'exhibition_デイリーアドバイス', appId: requireAppId(env, 'kintoneAppIdDailyAdvice') },
    { label: 'exhibition_ロールプレイセッション', appId: requireAppId(env, 'kintoneAppIdRoleplaySession') },
    { label: 'exhibition_商談ログ', appId: requireAppId(env, 'kintoneAppIdMeetingLog') },
    { label: 'exhibition_営業評価', appId: requireAppId(env, 'kintoneAppIdSalesScore') },
  ];

  // A fileKey is consumed on first use — reusing the same fileKey across apps, or even twice
  // within one customize.json call (desktop.js + mobile.js), fails with GAIA_DC04 "duplicate
  // fileKey". Each attachment point needs its own fresh upload.
  for (const target of jsAndCssTargets) {
    console.log(`Uploading chat.js + kintone-theme.css for ${target.label} ...`);
    const desktopJsKey = await kintone.uploadFile('chat.js', bundle);
    const mobileJsKey = await kintone.uploadFile('chat.js', bundle);
    const desktopCssKey = await kintone.uploadFile('kintone-theme.css', themeCss);
    const mobileCssKey = await kintone.uploadFile('kintone-theme.css', themeCss);

    console.log(`Attaching to ${target.label} (app id ${target.appId}) ...`);
    await kintone.setCustomize(target.appId, {
      desktop: {
        js: [{ type: 'FILE', file: { fileKey: desktopJsKey } }],
        css: [{ type: 'FILE', file: { fileKey: desktopCssKey } }],
      },
      mobile: {
        js: [{ type: 'FILE', file: { fileKey: mobileJsKey } }],
        css: [{ type: 'FILE', file: { fileKey: mobileCssKey } }],
      },
      scope: 'ALL',
    });

    // updateAppCustomize only updates the pre-live settings, like addFormFields/deployApp for
    // fields — it must be deployed to actually reach end users.
    console.log(`Deploying customize settings for ${target.label} ...`);
    await kintone.deployApp(target.appId);
    await kintone.waitForDeploy(target.appId);
  }

  for (const target of cssOnlyTargets) {
    console.log(`Uploading kintone-theme.css for ${target.label} ...`);
    const desktopCssKey = await kintone.uploadFile('kintone-theme.css', themeCss);
    const mobileCssKey = await kintone.uploadFile('kintone-theme.css', themeCss);

    console.log(`Attaching to ${target.label} (app id ${target.appId}) ...`);
    await kintone.setCustomize(target.appId, {
      desktop: { js: [], css: [{ type: 'FILE', file: { fileKey: desktopCssKey } }] },
      mobile: { js: [], css: [{ type: 'FILE', file: { fileKey: mobileCssKey } }] },
      scope: 'ALL',
    });

    console.log(`Deploying customize settings for ${target.label} ...`);
    await kintone.deployApp(target.appId);
    await kintone.waitForDeploy(target.appId);
  }

  console.log('Done. chat.js + kintone-theme.css attached to 取引先/案件/リード/担当者.');
  console.log('kintone-theme.css attached to the remaining 5 exhibition_* apps.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
