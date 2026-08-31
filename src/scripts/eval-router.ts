import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { BI_ROUTER_SYSTEM_PROMPT } from '../workflows/agent-workflow';

// RELVA BI (要件定義書 §9) — ルーターのマッピング精度を測る評価スクリプト。本番の
// BI_ROUTER_SYSTEM_PROMPT をそのまま(agent-workflow.ts からexportして)再利用するので、
// プロンプトが本番とズレることがない。目標精度90%は参考値・non-blocking —
// このスクリプトは常に exit code 0 で終わり、結果をレポートするだけ。

const QUESTIONS_PATH = path.resolve(process.cwd(), 'src/workflows/__tests__/eval/questions.json');

interface ExpectedPlan {
  template: string | null;
  metric?: string;
  dimension?: string;
  dimensionB?: string;
  needClarify?: boolean;
}

interface EvalCase {
  question: string;
  expected: ExpectedPlan;
}

interface RouterOutput {
  template: string | null;
  metric?: string | null;
  dimension?: string | null;
  dimensionB?: string | null;
  needClarify?: string | null;
}

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function callRouter(openaiApiKey: string, question: string): Promise<RouterOutput> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: BI_ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ message: question, history: [] }) },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`router call failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(body.choices[0].message.content) as RouterOutput;
}

// template + metric + dimension + primary filter(ここでは dimensionB)の一致を見る(要件定義書
// §9)。曖昧系の質問は template=null で一致し、needClarify の有無(true/false)だけを比較する。
function matches(actual: RouterOutput, expected: ExpectedPlan): boolean {
  if ((actual.template ?? null) !== expected.template) return false;
  if (expected.template === null) {
    const actualHasClarify = !!actual.needClarify;
    return expected.needClarify === undefined || actualHasClarify === expected.needClarify;
  }
  if (expected.metric && actual.metric !== expected.metric) return false;
  if (expected.dimension && expected.dimensionB) {
    // T5のクロス集計は rows/cols の割り当てが入れ替わっても集計結果は同じ(対称)——
    // どちらの順序で来ても正解とみなす。
    const sameOrder = actual.dimension === expected.dimension && actual.dimensionB === expected.dimensionB;
    const swappedOrder = actual.dimension === expected.dimensionB && actual.dimensionB === expected.dimension;
    return sameOrder || swappedOrder;
  }
  if (expected.dimension && actual.dimension !== expected.dimension) return false;
  if (expected.dimensionB && actual.dimensionB !== expected.dimensionB) return false;
  return true;
}

async function main() {
  const env = loadEnv();
  const openaiApiKey = requireEnvValue('OPENAI_API_KEY', env.openaiApiKey);
  const cases = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf-8')) as EvalCase[];

  let passed = 0;
  for (const testCase of cases) {
    let actual: RouterOutput;
    try {
      actual = await callRouter(openaiApiKey, testCase.question);
    } catch (err) {
      console.log(`✗ [ERROR] "${testCase.question}" -> ${(err as Error).message}`);
      continue;
    }
    const ok = matches(actual, testCase.expected);
    if (ok) passed++;
    console.log(
      `${ok ? '✓' : '✗'} "${testCase.question}"\n   expected: ${JSON.stringify(testCase.expected)}\n   actual:   ${JSON.stringify(
        actual,
      )}`,
    );
  }

  const accuracy = (passed / cases.length) * 100;
  console.log(`\n${passed}/${cases.length} matched (${accuracy.toFixed(1)}%). Target: 90%(参考値、non-blocking)。`);
  // 参考値であり合否判定はしない(要件定義書 §9) — CI等で使う場合もここで失敗させない。
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
