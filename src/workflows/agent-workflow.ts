import {
  ACCOUNT_INDUSTRY_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';

export const AGENT_WORKFLOW_NAME = '[kintone] 秘書AIエージェント';
export const AGENT_WEBHOOK_PATH = 'exhibition-agent-chat';

export interface AgentWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  accountAppId: number;
  accountApiToken: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  leadAppId: number;
  leadApiToken: string;
  dailyAdviceAppId: number;
  dailyAdviceApiToken: string;
  salesScoreAppId: number;
  salesScoreApiToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tavilyApiKey: string;
  pineconeHost: string;
  pineconeApiKey: string;
}

const SUPABASE_TENANT_ID = 'exhibition-asset';
// Separate from env.pineconeNamespace (used by bulk-sync-pinecone.ts for kintone records) so
// manual-document vectors and kintone-record vectors never mix — no metadata filter needed on
// either query.
const MANUAL_NAMESPACE = 'exhibition-manuals';

const PLANNER_SYSTEM_PROMPT = `あなたはCRMチャットの検索プランナーです。ユーザーの発言と直近の会話履歴から、
kintoneのレコード検索に使うキーワードを1つ抽出してください。会社名・案件名・人名などの
固有名詞を優先します。固有名詞が見つからない場合は空文字を返してください。

また、ユーザーの質問がkintone内のデータだけでは答えられない、リアルタイムの外部情報を
必要とする場合は、Web検索が必要かどうかも判定してください。
【Web検索が必要なケース】為替・株価・仮想通貨などの金融情報、最新ニュース・業界動向・
競合情報、天気・法改正など時事情報、その他kintoneに存在しないリアルタイム情報全般。

必ず次のJSON形式のみで回答してください(説明文は不要):
{"searchTerm": "抽出したキーワード", "intent": "search" | "edit" | "chat", "needsWebSearch": true | false, "webQuery": "Web検索用の簡潔なクエリ(不要な場合は空文字)"}

- intent: レコードの検索・参照が必要なら "search"、既存レコードの編集や新規登録の依頼なら "edit"、
  それ以外の一般的な会話なら "chat"
- needsWebSearch: 上記のケースに該当する場合のみtrue、それ以外はfalse
- webQuery: needsWebSearchがtrueの場合のみ、検索エンジンに投げる簡潔なクエリを入れる`;

const MAIN_SYSTEM_PROMPT = `あなたはkintone上のCRM「exhibition-asset」の営業秘書AIです。
以下のkintone検索結果(exhibition_取引先/exhibition_案件/exhibition_リードの一部レコード、
本日分のexhibition_デイリーアドバイス——n8nのCronが日次生成済み、および
exhibition_営業評価の直近の完了済み評価期間のランキング)と会話履歴を参考に、
ユーザーの質問に日本語で簡潔に答えてください。「今日やることを教えて」のような質問には
デイリーアドバイスのadvice_json(actions配列)を優先度順に整理して答えてください。
「一番評価の高い社員は?」「営業ランキングを教えて」のような質問には、
kintoneContext.salesScoreRecordsを使って答えてください(total_score降順で並んでいるため、
先頭が最も評価の高い担当者です。assignee_nameとtotal_score、score_rankを含めて答えること)。
salesScoreRecordsが空の場合のみ、評価データがまだ無いと答えてください。
salesScoreRecordsは評価スコア・ランクの情報であり、案件の件数そのものではありません
(スコアリング対象期間内の実行済みアクション数などが元になっており、担当している案件の
全件数とは一致しません)。案件の件数を聞かれた場合はsalesScoreRecordsの内容を件数として
使わないでください。

「担当者ごとの案件配分は?」「誰が何件案件を担当している?」のような質問には、必ず
kintoneContext.opportunityByOwner(担当者ごとの実際の案件件数の集計、[{owner, count}]の配列)
を使って答えてください。

件数を聞く質問には必ずkintoneContext.leadTotalCount/opportunityTotalCount/accountTotalCount
を使って答えてください。これらは「リードは何件ある?」のような全体件数だけでなく、
「(担当者名)が担当している案件はいくつ?」のように絞り込み条件付きの件数を聞かれた場合も
同様に対象です(絞り込みは検索結果の取得時に既に適用済みなので、対応するTotalCountの値が
その絞り込み後の正しい件数です)。
kintoneContext.leadRecords/opportunityRecords/accountRecordsの配列は表示用のサンプルで
最大5件しか入っていません。これらの配列の要素数(.length)を件数として数えたり報告したり
することは絶対にしないでください——実際の件数と食い違います。件数の回答には必ず
対応するTotalCountの数値そのものを使ってください。

correctionContextに過去の似た質問への人間による訂正内容が含まれている場合は、その内容を
優先して回答してください(過去に誤りとして訂正された回答パターンを繰り返さないこと)。

webSearchContextに外部Web検索結果が含まれている場合は、それを踏まえて回答してください。
出典のURLが分かる場合は回答内に簡潔に含めてください。

manualContextには社内マニュアル(経費精算規程・出張旅費規程・稟議承認フロー・営業活動マニュアル・
商談準備ガイド・提案書作成ガイドライン・商談後フォロー手順書・新入社員向け業務マニュアル・
社内FAQ・自社サービス説明資料など)から関連する抜粋が入っています。「経費申請の流れは?」
「出張の際の規定は?」「自社の製品について教えて」のような、社内ルールや自社製品・サービスに
関する質問にはmanualContextを優先して使い、根拠となった資料名(【】内のファイル名)に触れながら
答えてください。manualContextの内容が質問と関連しない場合は無視して構いません。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "answer": "回答本文(Markdown可)",
  "referencedRecords": [{"label": "表示名", "recordId": "レコードID", "appName": "取引先|案件|リード"}],
  "action": "show_form_account" | "show_form_edit_account" | "show_form_opportunity" | "show_form_edit_opportunity" | "generate_proposal" | null,
  "prefill": { "_recordId": "編集時・generate_proposal時のみ設定", "...": "フィールドコード: 値" }
}

prefillのキーは必ず以下のフィールドコード(英数字)を使ってください。日本語のラベルや
独自のキー名を使わないこと。値が不明なフィールドは省略してください。

- action が show_form_account / show_form_edit_account の場合、使えるフィールドコードは:
  company_name(会社名、自由入力), industry(業種、以下の選択肢から一字一句そのまま選ぶこと: ${ACCOUNT_INDUSTRY_OPTIONS.join(' / ')} — 当てはまらない場合はフィールドを省略), contact_name(担当者名、自由入力), phone(電話番号、自由入力),
  email(メールアドレス、自由入力), status(ステータス、以下の選択肢から一字一句そのまま選ぶこと: ${ACCOUNT_STATUS_OPTIONS.join(' / ')} — 不明ならフィールドを省略), memo(メモ、自由入力)
- action が show_form_opportunity / show_form_edit_opportunity の場合、使えるフィールドコードは:
  deal_name(案件名、自由入力), account(取引先の会社名、自由入力), amount(金額、自由入力), stage(フェーズ、以下の選択肢から一字一句そのまま選ぶこと: ${OPPORTUNITY_STAGE_OPTIONS.join(' / ')} — 不明ならフィールドを省略),
  close_date(クロージング予定日、YYYY-MM-DD形式), owner(担当者、自由入力), description(概要、自由入力)
- industry/status/stageは選択肢に一致しない値を絶対に入れないこと(kintoneがエラーになります)。
  ユーザーの発言が選択肢のどれにも当てはまらない場合は、そのフィールド自体をprefillに含めないこと。

- ユーザーが新規の取引先・案件登録を依頼したら action に "show_form_account" または
  "show_form_opportunity" を設定し、聞き取れた内容を上記フィールドコードで prefill に入れてください。
- ユーザーが既存レコードの編集(検索結果に含まれるレコード)を依頼したら action に
  "show_form_edit_account" または "show_form_edit_opportunity" を設定し、prefill._recordId に
  対象のレコードID、他のフィールドは既存値+変更後の値を上記フィールドコードで入れてください。
- ユーザーが特定の案件について提案資料・提案書・スライドの作成を依頼したら
  (例:「みらい建設の案件スライドを作成して」「◯◯の提案書を作って」)、これはmanualContextの
  AI_Slide_Generatorサービス説明資料の説明で終わらせず、実際に生成処理を実行してください。
  kintoneContext.opportunityRecordsの中から会社名・案件名が一致する案件を1件だけ確信を持って
  特定できた場合、action に "generate_proposal" を設定し、prefill._recordId にその案件の
  レコードID($idの値)を入れてください(他のprefillフィールドは不要)。
  一致する案件が0件、または複数件あって確信を持って1件に絞れない場合は、action を null にして
  回答本文でどの案件か確認する質問をしてください(誤った案件のスライドを生成しないこと)。
- 上記以外の質問には action を null にしてください。
- リード(exhibition_リード)の編集・登録フォームは未対応です。リードについては検索結果を
  回答本文で説明するのみにしてください。`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildAgentWorkflow(config: AgentWorkflowConfig) {
  const positions = offsetPositions(0, 300, 28);
  let p = 0;
  const nextPos = () => positions[p++];

  const kintoneHeader = (token: string) => [{ name: 'X-Cybozu-API-Token', value: token }];
  const openaiHeaders = () => [
    { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];
  const supabaseHeaders = () => [
    { name: 'apikey', value: config.supabaseServiceRoleKey },
    { name: 'Authorization', value: `Bearer ${config.supabaseServiceRoleKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];
  const pineconeHeaders = () => [
    { name: 'Api-Key', value: config.pineconeApiKey },
    { name: 'Content-Type', value: 'application/json' },
  ];

  const nodes = [
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        httpMethod: 'POST',
        path: AGENT_WEBHOOK_PATH,
        responseMode: 'responseNode',
      },
    },
    {
      id: 'verify_secret',
      name: 'Verify Secret',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const expected = ${JSON.stringify(config.webhookSecret)};
const headers = $input.item.json.headers || {};
const provided = headers['x-webhook-secret'];
return [{ json: { ...$input.item.json, valid: provided === expected } }];
`.trim(),
      },
    },
    {
      id: 'secret_valid_if',
      name: 'Secret Valid?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{$json.valid}}', value2: true }],
        },
      },
    },
    {
      id: 'respond_unauthorized',
      name: 'Respond Unauthorized',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [positions[2][0] + 220, positions[2][1] + 200] as [number, number],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "error": "invalid webhook secret" } }}',
        options: { responseCode: 401 },
      },
    },
    {
      id: 'feedback_check_if',
      name: 'Feedback Check?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          string: [{ value1: '={{$json.body.message}}', value2: '__feedback__' }],
        },
      },
    },
    {
      id: 'negative_feedback_if',
      name: 'Negative Feedback?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          string: [{ value1: '={{$json.body.feedback.type}}', value2: 'negative' }],
        },
      },
    },
    {
      id: 'embed_feedback_question',
      name: 'Embed Feedback Question',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/embeddings',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "text-embedding-3-small", input: $json.body.feedback.question }) }}',
        options: {},
      },
    },
    {
      id: 'save_feedback_embedding',
      name: 'Save Feedback Embedding',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `${config.supabaseUrl}/rest/v1/feedback_embeddings`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...supabaseHeaders(), { name: 'Prefer', value: 'return=minimal' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ tenant_id: ${JSON.stringify(SUPABASE_TENANT_ID)}, question: $node["Negative Feedback?"].json.body.feedback.question, ai_answer: $node["Negative Feedback?"].json.body.feedback.ai_answer, user_correction: $node["Negative Feedback?"].json.body.feedback.user_correction, embedding: $json.data[0].embedding }) }}`,
        options: {},
      },
    },
    {
      id: 'respond_feedback_ack',
      name: 'Respond Feedback Ack',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: nextPos(),
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ success: true }) }}',
      },
    },
    {
      id: 'query_planner',
      name: 'Query Planner',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(PLANNER_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $json.body.message, history: ($json.body.history || []).slice(-6) }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_query_plan',
      name: 'Parse Query Plan',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Verify Secret"].json.body || {};
let plan;
try {
  plan = JSON.parse($json.choices[0].message.content);
} catch (e) {
  plan = { searchTerm: original.message || '', intent: 'chat', needsWebSearch: false, webQuery: '' };
}
return [{ json: { ...original, plan } }];
`.trim(),
      },
    },
    {
      id: 'search_account',
      name: 'Search Account',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.accountApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.accountAppId) },
            {
              name: 'query',
              value:
                '={{ $json.plan.searchTerm ? ("company_name like \\"" + $json.plan.searchTerm.replace(/"/g, "") + "\\" or contact_name like \\"" + $json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
            // limit 5 above keeps the AI's context small, but that means the AI never sees the
            // true record count — without this it will answer "何件?" questions with the sample
            // size (5) instead of the real total. totalCount:true asks kintone to also return the
            // actual matching count without fetching every record.
            { name: 'totalCount', value: 'true' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_opportunity',
      name: 'Search Opportunity',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.opportunityApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            {
              name: 'query',
              // owner is included alongside deal_name/account so that "飯田が担当している案件は
              // いくつ?"-style questions (searchTerm = a person's name) actually filter by the
              // assignee, instead of only matching deal/company names and silently falling through
              // to an unfiltered "limit 5" that made every such question answer with the sample size.
              value:
                '={{ $node["Parse Query Plan"].json.plan.searchTerm ? ("deal_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" or account like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" or owner like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
            { name: 'totalCount', value: 'true' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_lead',
      name: 'Search Lead',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.leadApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.leadAppId) },
            {
              name: 'query',
              value:
                '={{ $node["Parse Query Plan"].json.plan.searchTerm ? ("lead_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" or company_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
            { name: 'totalCount', value: 'true' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_opportunity_owners',
      name: 'Search Opportunity Owners',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.opportunityApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            // Unfiltered fetch of every opportunity — the keyword-filtered "Search Opportunity"
            // node above only ever returns up to 5 sample records, which is not enough to build a
            // real per-assignee breakdown ("担当者ごとの案件配分"). Demo scale (dozens of
            // opportunities) fits well under kintone's 500-record cap in one call; a larger
            // deployment would need the offset-based paging used elsewhere (e.g.
            // bulk-sync-pinecone.ts). Not restricting `fields` here since kintone expects that as
            // an array-style param (fields[0]=...), which n8n's flat key/value query params can't
            // express directly — the full record is small enough at this scale anyway.
            { name: 'query', value: 'limit 500' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_daily_advice',
      name: 'Search Daily Advice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.dailyAdviceApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.dailyAdviceAppId) },
            {
              name: 'query',
              value:
                '={{ "advice_date = \\"" + new Date().toISOString().slice(0, 10) + "\\" and assignee_code = \\"" + ($node["Parse Query Plan"].json.userCode || "").replace(/"/g, "") + "\\" limit 1" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_sales_score',
      name: 'Search Sales Score',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.salesScoreApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.salesScoreAppId) },
            {
              // "完了"ステータスの中で最新のperiod_endを持つレコード群が先頭に来るよう
              // period_end desc, total_score descの2キーでソートする(status は kintone の
              // 予約フィールド名のため = ではなく in を使う必要がある)。limit 20はデモ規模の
              // 担当者数を想定した値で、これを超える場合は offset を使ったページングが必要。
              name: 'query',
              value: 'status in ("完了") order by period_end desc, total_score desc limit 20',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'embed_user_message',
      name: 'Embed User Message',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/embeddings',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "text-embedding-3-small", input: $node["Parse Query Plan"].json.message }) }}',
        options: {},
      },
    },
    {
      id: 'pinecone_query_manuals',
      name: 'Pinecone Query Manuals',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `https://${config.pineconeHost}/query`,
        sendHeaders: true,
        headerParameters: { parameters: pineconeHeaders() },
        sendBody: true,
        specifyBody: 'json',
        // Reuses the same embedding computed for the Supabase feedback-similarity search just
        // above — one extra vector-DB query instead of a second OpenAI embeddings call.
        jsonBody: `={{ JSON.stringify({ vector: $node["Embed User Message"].json.data[0].embedding, topK: 5, namespace: ${JSON.stringify(MANUAL_NAMESPACE)}, includeMetadata: true }) }}`,
        options: {},
      },
    },
    {
      id: 'supabase_feedback_search',
      name: 'Supabase Feedback Search',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      // PostgREST returns a bare JSON array; n8n splits arrays into one item per element, so an
      // empty match list (the normal case until a correction is ever saved) becomes zero items,
      // which silently halts the whole downstream chain. Force at least one item through.
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `${config.supabaseUrl}/rest/v1/rpc/match_feedback_embeddings`,
        sendHeaders: true,
        headerParameters: { parameters: supabaseHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ query_embedding: $json.data[0].embedding, match_tenant_id: ${JSON.stringify(SUPABASE_TENANT_ID)}, match_count: 5 }) }}`,
        options: {},
      },
    },
    {
      id: 'needs_web_search_if',
      name: 'Needs Web Search?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          boolean: [
            { value1: '={{$node["Parse Query Plan"].json.plan.needsWebSearch}}', value2: true },
          ],
        },
      },
    },
    {
      id: 'tavily_search',
      name: 'Tavily Search',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: 'https://api.tavily.com/search',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ api_key: ${JSON.stringify(config.tavilyApiKey)}, query: $node["Parse Query Plan"].json.plan.webQuery, search_depth: "basic", max_results: 5 }) }}`,
        options: {},
      },
    },
    {
      id: 'merge_search_results',
      name: 'Merge Search Results',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Parse Query Plan"].json;
const feedbackMatches = (Array.isArray($node["Supabase Feedback Search"].json) ? $node["Supabase Feedback Search"].json : [])
  .filter((m) => (m.similarity || 0) >= 0.4)
  .slice(0, 5);
const correctionContext = feedbackMatches.length
  ? feedbackMatches.map((m) => "似た質問: " + m.question + " / 訂正内容: " + m.user_correction).join("\\n")
  : "";
let tavilyResults = [];
try {
  const tavilyJson = $node["Tavily Search"].json;
  tavilyResults = Array.isArray(tavilyJson?.results) ? tavilyJson.results : [];
} catch (e) {
  tavilyResults = [];
}
const webSearchContext = tavilyResults.length
  ? tavilyResults.slice(0, 5).map((r) => "【" + r.title + "】\\n" + r.content + "\\n出典: " + r.url).join("\\n\\n")
  : "";
const manualMatches = (Array.isArray($node["Pinecone Query Manuals"].json.matches) ? $node["Pinecone Query Manuals"].json.matches : [])
  .filter((m) => (m.score || 0) >= 0.3)
  .slice(0, 5);
const manualContext = manualMatches.length
  ? manualMatches.map((m) => "【" + (m.metadata && m.metadata.fileName || "社内マニュアル") + "】\\n" + (m.metadata && m.metadata.text || "")).join("\\n\\n")
  : "";
const ownerCounts = {};
for (const r of ($node["Search Opportunity Owners"].json.records || [])) {
  const owner = (r.owner && r.owner.value) || "(未設定)";
  ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
}
const opportunityByOwner = Object.entries(ownerCounts).map(([owner, count]) => ({ owner, count }));
return [{ json: {
  ...original,
  correctionContext,
  webSearchContext,
  manualContext,
  kintoneContext: {
    accountRecords: ($node["Search Account"].json.records || []),
    accountTotalCount: Number($node["Search Account"].json.totalCount || 0),
    opportunityRecords: ($node["Search Opportunity"].json.records || []),
    opportunityTotalCount: Number($node["Search Opportunity"].json.totalCount || 0),
    leadRecords: ($node["Search Lead"].json.records || []),
    leadTotalCount: Number($node["Search Lead"].json.totalCount || 0),
    dailyAdviceRecords: ($node["Search Daily Advice"].json.records || []),
    salesScoreRecords: ($node["Search Sales Score"].json.records || []),
    opportunityByOwner,
  },
} }];
`.trim(),
      },
    },
    {
      id: 'main_ai',
      name: 'Main AI',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(MAIN_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $json.message, history: ($json.history || []).slice(-12), lastKintoneContext: $json.lastKintoneContext || null, kintoneContext: $json.kintoneContext, correctionContext: $json.correctionContext || "", webSearchContext: $json.webSearchContext || "", manualContext: $json.manualContext || "" }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'format_response',
      name: 'Format Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Merge Search Results"].json;
const ALLOWED_ACTIONS = ["show_form_account", "show_form_edit_account", "show_form_opportunity", "show_form_edit_opportunity", "generate_proposal"];
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  const raw = ($json.choices && $json.choices[0] && $json.choices[0].message && $json.choices[0].message.content) || "";
  parsed = { answer: raw || "申し訳ございません、応答の生成に失敗しました。" };
}
if (parsed.action && ALLOWED_ACTIONS.indexOf(parsed.action) === -1) {
  delete parsed.action;
  delete parsed.prefill;
}
return [{ json: {
  response: parsed,
  sessionId: original.sessionId || "",
  userId: original.userId || "",
  userName: original.userName || "",
  message: original.message || "",
} }];
`.trim(),
      },
    },
    {
      id: 'save_to_supabase',
      name: 'Save to Supabase',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `${config.supabaseUrl}/rest/v1/answer_log`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...supabaseHeaders(), { name: 'Prefer', value: 'return=minimal' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ tenant_id: ${JSON.stringify(SUPABASE_TENANT_ID)}, session_id: $json.sessionId, user_id: $json.userId, question: $json.message, ai_answer: $json.response && $json.response.answer || "" }) }}`,
        options: {},
      },
    },
    {
      id: 'respond_to_webhook',
      name: 'Respond to Webhook',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: nextPos(),
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $node["Format Response"].json.response }}',
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [{ node: 'Feedback Check?', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Feedback Check?': {
      main: [
        [{ node: 'Negative Feedback?', type: 'main', index: 0 }],
        [{ node: 'Query Planner', type: 'main', index: 0 }],
      ],
    },
    'Negative Feedback?': {
      main: [
        [{ node: 'Embed Feedback Question', type: 'main', index: 0 }],
        [{ node: 'Respond Feedback Ack', type: 'main', index: 0 }],
      ],
    },
    'Embed Feedback Question': { main: [[{ node: 'Save Feedback Embedding', type: 'main', index: 0 }]] },
    'Save Feedback Embedding': { main: [[{ node: 'Respond Feedback Ack', type: 'main', index: 0 }]] },
    'Query Planner': { main: [[{ node: 'Parse Query Plan', type: 'main', index: 0 }]] },
    'Parse Query Plan': { main: [[{ node: 'Search Account', type: 'main', index: 0 }]] },
    'Search Account': { main: [[{ node: 'Search Opportunity', type: 'main', index: 0 }]] },
    'Search Opportunity': { main: [[{ node: 'Search Lead', type: 'main', index: 0 }]] },
    'Search Lead': { main: [[{ node: 'Search Opportunity Owners', type: 'main', index: 0 }]] },
    'Search Opportunity Owners': { main: [[{ node: 'Search Daily Advice', type: 'main', index: 0 }]] },
    'Search Daily Advice': { main: [[{ node: 'Search Sales Score', type: 'main', index: 0 }]] },
    'Search Sales Score': { main: [[{ node: 'Embed User Message', type: 'main', index: 0 }]] },
    'Embed User Message': { main: [[{ node: 'Pinecone Query Manuals', type: 'main', index: 0 }]] },
    'Pinecone Query Manuals': { main: [[{ node: 'Supabase Feedback Search', type: 'main', index: 0 }]] },
    'Supabase Feedback Search': { main: [[{ node: 'Needs Web Search?', type: 'main', index: 0 }]] },
    'Needs Web Search?': {
      main: [
        [{ node: 'Tavily Search', type: 'main', index: 0 }],
        [{ node: 'Merge Search Results', type: 'main', index: 0 }],
      ],
    },
    'Tavily Search': { main: [[{ node: 'Merge Search Results', type: 'main', index: 0 }]] },
    'Merge Search Results': { main: [[{ node: 'Main AI', type: 'main', index: 0 }]] },
    'Main AI': { main: [[{ node: 'Format Response', type: 'main', index: 0 }]] },
    'Format Response': { main: [[{ node: 'Save to Supabase', type: 'main', index: 0 }]] },
    'Save to Supabase': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: AGENT_WORKFLOW_NAME, nodes, connections };
}
