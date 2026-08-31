import {
  ACCOUNT_INDUSTRY_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  LOSS_REASON_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';
import { aggregateEmbeddable } from '../semantic/aggregate';
import { cardsEmbeddable } from '../semantic/cards';
import { fiscalEmbeddable } from '../semantic/fiscal';

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
kintoneのレコード検索に使うキーワードを抽出してください。会社名・案件名・人名などの
固有名詞を優先します。「桜商事と山田製作所とみらい建設工業を比較して」のように複数の
固有名詞が含まれる場合は、見つかった分だけすべて配列に入れてください(最大3件)。
固有名詞が見つからない場合は空配列を返してください。

また、ユーザーの質問がkintone内のデータだけでは答えられない、リアルタイムの外部情報を
必要とする場合は、Web検索が必要かどうかも判定してください。
【Web検索が必要なケース】為替・株価・仮想通貨などの金融情報、最新ニュース・業界動向・
競合情報、天気・法改正など時事情報、その他kintoneに存在しないリアルタイム情報全般。

必ず次のJSON形式のみで回答してください(説明文は不要):
{"searchTerms": ["抽出したキーワード1", "抽出したキーワード2"], "intent": "search" | "edit" | "chat", "needsWebSearch": true | false, "webQuery": "Web検索用の簡潔なクエリ(不要な場合は空文字)"}

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
dailyAdviceRecordsが空の場合(その日のCronがまだ実行されていない、生成前の時間帯など)は、
「アドバイスがありません」で終わらせず、代わりにkintoneContext.myOpenDeals(質問者本人が
担当している、成約・失注以外の案件をクロージング予定日が近い順に並べたもの)を使って、
今日優先すべきと思われる案件をその場で提案してください。その際は「本日分の正式なアドバイスは
まだ生成されていませんが、現在担当している案件から」のように、正式生成ではない即席の提案で
あることを一言添えてください。myOpenDealsが空の場合は、必ず「現在担当している案件が無い」旨を
正直に答えてください。この場合、kintoneContext.opportunityRecords等の無関係な(質問者本人の
担当ではない)案件を代わりに紹介することは絶対にしないでください——それは他の担当者の案件を
質問者自身のものとして誤って伝えることになります。

ユーザーの発言が空文字・意味の無い文字列(単純な文字の繰り返しなど)・具体的な質問として
成立していない場合は、kintoneContextにある何らかのデータ(営業ランキングなど)を無理に
結びつけて答えようとしないでください。この場合は「どのようなご質問でしょうか?」のように
聞き返してください。
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

「成約した案件は何件?」「失注は何件?」「提案中の案件はいくつ?」のようなフェーズ(stage)別の
件数を聞く質問には、必ずkintoneContext.opportunityByStage([{stage, count}]の配列)を使って
答えてください。opportunityTotalCount(下記)はフェーズ名では絞り込めません——フェーズ名を
検索キーワードとして案件名/取引先名/担当者名に対して文字列検索してしまい、無関係な件数に
なるため、フェーズ別の件数には絶対に使わないでください。

件数を聞く質問には必ずkintoneContext.leadTotalCount/opportunityTotalCount/accountTotalCount
を使って答えてください。これらは「リードは何件ある?」のような全体件数、および
「(担当者名)が担当している案件はいくつ?」のように担当者名・会社名・案件名で絞り込んだ件数
(絞り込みは検索結果の取得時に既に適用済み)が対象です。フェーズ別の件数には使わないこと
(上記のopportunityByStageを使ってください)。
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
  回答本文で説明するのみにしてください。
- レコードの削除機能(個別・一括のいずれも)は一切サポートしていません。削除を依頼された場合は
  対応できない旨を伝えてください。「個別になら削除できます」のような、実際には存在しない
  操作が可能であるかのような表現は絶対にしないでください。`;

/**
 * RELVA BI (要件定義書 §5) — NL→テンプレート ルーター。既存の Query Planner / Main AI とは
 * 完全に独立した経路として動く(Feedback Check? の false 分岐の直後、Query Planner の手前で
 * 分岐する)。このプロンプトの役割は「集計に使うパラメータを選ぶこと」だけで、数値の計算は
 * 一切行わない——実際の集計は src/semantic/aggregate.ts(Aggregate BI ノードに埋め込み)が
 * 決定的に行う。src/scripts/eval-router.ts がこのプロンプトをそのまま再利用して精度を測る。
 */
export const BI_ROUTER_SYSTEM_PROMPT = `あなたはCRMチャットの「分析(BI)質問」判定・変換ルーターです。ユーザーの発言が
案件・リードの集計/分析に関する質問かどうかを判定し、該当する場合は集計に使うパラメータへ
変換してください。あなた自身は数値を計算しません——パラメータを選ぶことだけが役目です。

【対象となる質問の例】
「今期の受注額はいくら?」「担当者別の受注額を見せて」「フェーズごとの件数は?」
「失注理由を業種別に分析して」「パイプラインの状況を教えて」「受注率はどれくらい?」
「今月クロージング予定の案件一覧を見せて」

【対象外(分析質問ではない)の例】
特定の会社名・案件名・人物についての質問、雑談、新規登録・編集の依頼、削除依頼、
一般的な使い方の質問など。この場合は template を null にしてください。

利用できる指標(metric)は次のいずれかのみです:
- count(件数) / amount_sum(金額合計) / amount_avg(平均金額) / won_amount(受注額、stage=成約のみ)
- won_count(受注件数) / lost_count(失注件数) / win_rate(受注率、成約+失注を分母とする)

利用できる次元(dimension)は次のいずれかのみです:
- owner(担当者、案件のフィールド、自由入力)
- stage(フェーズ、案件のフィールド、選択肢: ${OPPORTUNITY_STAGE_OPTIONS.join(' / ')})
- industry(業種、案件のフィールド、選択肢: ${ACCOUNT_INDUSTRY_OPTIONS.join(' / ')})
- loss_reason(失注理由、案件のフィールド、選択肢: ${LOSS_REASON_OPTIONS.join(' / ')} —
  stage=失注でない案件には意味を持たない次元です)
- account(取引先、案件のフィールド、自由入力)
- lead_source(流入経路、リードのフィールド、選択肢: ${LEAD_SOURCE_OPTIONS.join(' / ')})
- lead_status(リードステータス、リードのフィールド、選択肢: ${LEAD_STATUS_OPTIONS.join(' / ')})

lead_source/lead_status を使う場合、metric は count のみ選べます(リードには金額・フェーズが
存在しないため)。上記以外の次元・指標名は存在しません——似た言葉が出てきても無理に対応
させず、対象外として扱ってください。

テンプレート(template)は次のいずれかを選んでください:
- "T1": 単一の数値のみを聞いている(例:「今期の受注額は?」「今月の成約件数は?」)。dimension不要。
- "T2": 1つの次元でカテゴリ別に集計したい(例:「担当者別の受注額」「流入経路別のリード数」
  「業種別の受注率」)。dimensionが必須です。metricは count/amount_sum に限らず win_rate 等
  どの指標でも構いません——「業種別の受注率」のように"○○別のX"という言い方でも、次元が
  1つしか無ければT2です(T5と混同しないこと)。
- "T4": パイプライン/フェーズ推移を見たい(例:「パイプラインの状況」「フェーズごとの件数」)。
  常にフェーズ別の指標を返すため、metric以外(dimension等)は不要です。
- "T5": **2つの次元が明示されている**クロス集計をしたい場合のみ(例:「失注理由を業種別に」
  =失注理由×業種の2軸、「担当者ごとのフェーズ別件数」=担当者×フェーズの2軸)。次元が1つしか
  無い質問(「業種別の受注率」等)をT5にしないこと。dimensionとdimensionBの両方が必須です。
  同じ対象(案件どうし、またはリードどうし)の次元のみ組み合わせ可能です。
- "T8": 条件に合う案件の一覧が欲しい(例:「今月クロージング予定の案件一覧」)。metric・
  dimensionは不要です。

filtersには、質問に含まれる絞り込み条件を入れてください(期間を除く)。各要素は
{"field": "実フィールドコード", "op": "="|"!="|"in"|"not_in", "value": "文字列 または 文字列配列"}
の形式です。使えるfieldは stage / owner / industry / loss_reason / account(案件)、
status / source(リード)のみで、値は上で示した選択肢と一字一句そのまま一致させてください。

期間の絞り込みはfiltersに入れず、代わりに period で表現してください:
- "current_fiscal_year": 「今期」「今年度」など、または期間の指定がない場合のデフォルト。
- "current_month": 「今月」
- "last_month": 「先月」
- "all": 明示的に「全期間」「これまでの累計」など期間を絞らない場合
上記に無い期間(特定の四半期・特定の月名など)を指定された場合は、template を null にし、
needClarify でその期間が未対応である旨を伝えてください。

判定した内容が曖昧・矛盾している場合(必須のdimensionが無い、metricとdimensionの組み合わせが
無効など)は、template を null にし、needClarify に日本語の聞き返し文を入れてください。
分析質問でない場合(対象外の例に該当する場合)は needClarify も null にしてください。

【現在のカード(直前に表示中のグラフ)について、op(意図)の判定】
ユーザーメッセージのJSONには currentCard(直前にチャットへ表示したグラフの template/params。
無ければ null)が含まれます。あなたはまず次の4つの意図(op)のどれかを判定してください:

- "query": 新しい集計を1から行いたい場合。currentCardが無い場合は必ずqueryです。currentCard
  があっても、テンプレそのものが変わるような全く別の質問(例:表示中が「担当者別の受注額」
  なのに「今月の成約件数は?」)もqueryとして扱ってください。
- "refine": currentCardがあり、「今表示されているグラフの一部だけを変えたい」という意図の場合
  (例:「業種で見せて」「先月で」「上位5件だけ」「金額じゃなくて件数で」)。templateは
  currentCardと同じものとして扱われるため出力不要です。metric/dimension/dimensionB/filters/
  period/topN/sortのうち、変更したいものだけに値を入れ、変更しないものは必ず null にして
  ください(currentCardの値がそのまま維持されます)。
- "narrate": currentCardがあり、ユーザーが今表示されているグラフの内容について尋ねている場合
  (例:「このグラフについて何が言える?」「なぜこうなってるの?」「特徴を教えて」)。新しい
  集計は不要なので、op以外のフィールドはすべて null で構いません。
- "clarify": ユーザーの発言が分析(BI)の質問であることは明らかだが、テンプレート/指標/次元を
  1つに決めるための情報が足りない場合のみ(例:「分析して」「グラフで見せて」のように、
  何を集計したいか特定できない)。needClarifyに聞き返し文を入れてください。

★重要: 「対象外(分析質問ではない)の例」に該当する発言(特定の会社名・案件名・人物についての
質問、雑談、新規登録・編集・削除の依頼、天気などの無関係な質問等)は、情報が足りないわけでは
なく単に分析質問ではないので、clarifyを選ばないでください。この場合は op を "query" のまま
にして template を null、needClarify も null にしてください(一般チャットへそのまま委ねます)。
"clarify"は「分析質問ではあるが曖昧」なケース専用です——分析質問かどうか自体が怪しい場合は
"clarify"ではなく template:null の"query"を選んでください。

currentCardが無い状態(null)では、refine・narrateを選ばないでください(その場合は必ず
query または clarify になります)。

必ず次のJSON形式のみで回答してください(説明文は不要):
{"op": "query"|"refine"|"narrate"|"clarify", "template": "T1"|"T2"|"T4"|"T5"|"T8"|null, "metric": "<指標コード>"|null, "dimension": "<次元コード>"|null, "dimensionB": "<次元コード>"|null, "period": "current_fiscal_year"|"current_month"|"last_month"|"all"|null, "topN": <数値>|null, "sort": "value_desc"|"value_asc"|"label"|null, "filters": [...], "needClarify": "<日本語の聞き返し文>"|null}`;

/**
 * RELVA BI (要件定義書 §1 絶対原則) — factSheet に既にある数値・表記のみを引用してよく、
 * 新しい数値の計算・発明はもちろん、金額の万円換算やパーセント表記への変換もLLMにさせない
 * ナレーション生成。「815万円」を「8,150万円」と一桁多く言う事故が実際に本番で発生した
 * (Aggregate BI が円の生数値をそのまま渡し、LLM自身に万円変換を計算させていたのが原因)ため、
 * Aggregate BI 側で表記を確定させた factSheet だけを渡し、LLMには引用のみをさせる。
 */
export const BI_NARRATIVE_SYSTEM_PROMPT = `あなたはBIチャットの一言コメント生成器です。与えられたJSON({title, interpretation,
factSheet})を読み、日本語で1〜2文の短いコメントを書いてください。

factSheetに書かれている数値・単位の表記(「約815万円」「40.0%」のような書式)は既に
確定済みの表示用文字列です。そのまま引用してください——万円への換算やパーセントへの変換、
桁の書き直しなど、表記を自分で計算し直すことは絶対にしないでください(単位を書き換えると
桁を間違えます)。factSheetに無い数値を新しく計算したり発明したりもしないでください。
断定的な結論よりも、気づきや次のアクションにつながる短いコメントを心がけてください。

必ず次のJSON形式のみで回答してください(説明文は不要): {"narrative": "コメント本文"}`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildAgentWorkflow(config: AgentWorkflowConfig) {
  const positions = offsetPositions(0, 300, 28);
  let p = 0;
  const nextPos = () => positions[p++];

  // RELVA BI (要件定義書 §5) — 既存チェーンとは別の並列サブグラフ。キャンバス上で見分けやすい
  // よう、既存の下(y=620)に別レーンとして配置する(実行順序には影響しない)。
  const biPositions = offsetPositions(660, 620, 14);
  let bp = 0;
  const nextBiPos = () => biPositions[bp++];

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
    // ---- RELVA BI (要件定義書 §5) サブグラフ開始 ----
    // Feedback Check? の false 分岐から Query Planner へ向かう手前で分岐する。BI質問でなければ
    // Is BI Question? の false 分岐からそのまま既存の Query Planner に合流し、以降の一般チャット
    // 経路は一切変更しない。
    {
      id: 'bi_router',
      name: 'BI Router',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(BI_ROUTER_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $json.body.message, history: ($json.body.history || []).slice(-6), currentCard: $json.body.currentCard || null }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_bi_plan',
      name: 'Parse BI Plan',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
${cardsEmbeddable()}

const original = $node["Verify Secret"].json.body || {};
const currentCard = original.currentCard || null;

const METRIC_CODES = ["count", "amount_sum", "amount_avg", "won_amount", "won_count", "lost_count", "win_rate"];
const DIMENSION_FIELD_MAP = {
  owner: { field: "owner", targetApp: "opportunity" },
  stage: { field: "stage", targetApp: "opportunity" },
  industry: { field: "industry", targetApp: "opportunity" },
  loss_reason: { field: "loss_reason", targetApp: "opportunity" },
  account: { field: "account", targetApp: "opportunity" },
  lead_source: { field: "source", targetApp: "lead" },
  lead_status: { field: "status", targetApp: "lead" },
};
const TEMPLATE_IDS = ["T1", "T2", "T4", "T5", "T8"];
const PERIODS = ["current_fiscal_year", "current_month", "last_month", "all"];

let raw;
try {
  raw = JSON.parse($json.choices[0].message.content);
} catch (e) {
  raw = {};
}

// 決定的なバリデーション: ルーターLLMの出力を鵜呑みにせず、既知のコード集合と組み合わせの
// 妥当性をここでコード側に確認させる(LLMのプロンプト遵守だけに頼らない——このファイルの
// 既存の Format Response が同じ理由で採用している方針を踏襲)。
function needClarify(message) {
  return { isBiQuestion: true, op: "clarify", template: null, needClarify: message };
}

// query/refine共通: テンプレ・指標・次元の組み合わせが妥当かを検証する。
// 妥当なら null、妥当でなければ聞き返し文言を返す。
function validateShape(template, metric, dimension, dimensionB) {
  const dim = dimension ? DIMENSION_FIELD_MAP[dimension] : undefined;
  const dimB = dimensionB ? DIMENSION_FIELD_MAP[dimensionB] : undefined;
  // T8(条件抽出リスト)は runAggregate 側で metric を一切参照しない(固定カラムの一覧を返す
  // だけ)ため、ここでも metric を必須にしない——実際にライブでT8質問が「指標を教えて」と
  // 聞き返されてしまう回帰を起こしたため明示的に除外している。
  const metricOk = template === "T8" || (metric && METRIC_CODES.indexOf(metric) !== -1);

  if (!metricOk) return "どの指標について知りたいか教えていただけますか?(例: 件数、金額合計、受注率など)";
  if (dimension && !dim) return "すみません、その切り口には対応していません。担当者別・フェーズ別・業種別・失注理由別・流入経路別などでお試しください。";
  if (dimensionB && !dimB) return "すみません、その切り口には対応していません。";
  if (dim && dim.targetApp === "lead" && template !== "T8" && metric !== "count") return "リードの分析では件数のみ集計できます。";
  if (template === "T2" && !dim) return "何を軸にカテゴリ別に見たいか教えていただけますか?(例: 担当者別、フェーズ別など)";
  if (template === "T5" && (!dim || !dimB)) return "クロス集計には2つの軸が必要です。例えば「失注理由を業種別に」のように教えてください。";
  if (template === "T5" && dim && dimB && dim.targetApp !== dimB.targetApp) return "クロス集計は案件どうし、またはリードどうしの軸のみ組み合わせられます。";
  return null;
}

function sanitizeFilters(filters) {
  return Array.isArray(filters) ? filters.filter((f) => f && typeof f.field === "string" && typeof f.op === "string") : [];
}

const VALID_OPS = ["query", "refine", "narrate", "clarify"];
const op = raw && VALID_OPS.indexOf(raw.op) !== -1 ? raw.op : "query";

let plan;
if (op === "clarify") {
  plan = needClarify(raw && raw.needClarify ? String(raw.needClarify) : "もう少し詳しく教えていただけますか?");
} else if (op === "narrate") {
  // RELVA BI 追加要件定義書 §4: narrateは新しい集計を一切行わない——直前のカードの
  // 確定済みデータ(currentCard)だけを根拠にコメントさせる。currentCardが無ければ聞き返す。
  if (!currentCard || !currentCard.template) {
    plan = needClarify("直前に表示されているグラフが無いため、まず何を見たいか教えてください。");
  } else {
    // metric/dimension/dimensionB/period/filtersをcurrentCard.paramsからそのまま引き継ぐ
    // (何も変更しないため refine() は使わない)。Build Narrate Input / Format BI Response が
    // cardSpec を一律に組み立てられるよう、query/refineと同じ形のbiPlanにしておく。
    const p = currentCard.params || {};
    plan = {
      isBiQuestion: true,
      op: "narrate",
      template: currentCard.template,
      metric: p.metric,
      dimension: p.dimension || undefined,
      dimensionB: p.dimensionB || undefined,
      period: p.period && p.period.preset ? p.period.preset : "current_fiscal_year",
      filters: p.filters || [],
      needClarify: null,
    };
  }
} else if (op === "refine") {
  if (!currentCard || !currentCard.template) {
    plan = needClarify("直前に表示されているグラフが無いため、まず何を見たいか教えてください。");
  } else {
    // ワンクリックのチップ操作も自然言語リファインも同じ refine() を通す(cards.ts §3)。
    const patch = {};
    if (raw.metric && METRIC_CODES.indexOf(raw.metric) !== -1) patch.metric = raw.metric;
    if (raw.dimension) patch.dimension = raw.dimension;
    if (raw.dimensionB) patch.dimensionB = raw.dimensionB;
    if (Array.isArray(raw.filters) && raw.filters.length > 0) patch.filters = sanitizeFilters(raw.filters);
    if (raw.period && PERIODS.indexOf(raw.period) !== -1) patch.period = { preset: raw.period };
    if (typeof raw.topN === "number") patch.topN = raw.topN;
    if (raw.sort) patch.sort = raw.sort;

    const merged = refine(currentCard.template, currentCard.params || {}, patch);
    const invalidMsg = validateShape(currentCard.template, merged.metric, merged.dimension, merged.dimensionB);
    if (invalidMsg) {
      plan = needClarify(invalidMsg);
    } else {
      plan = {
        isBiQuestion: true,
        op: "refine",
        template: currentCard.template,
        metric: merged.metric,
        dimension: merged.dimension || undefined,
        dimensionB: merged.dimensionB || undefined,
        period: merged.period && merged.period.preset ? merged.period.preset : "current_fiscal_year",
        filters: merged.filters || [],
        needClarify: null,
      };
    }
  }
} else if (!raw || !raw.template || TEMPLATE_IDS.indexOf(raw.template) === -1) {
  // op === "query" だが template が無い/未知 = 分析質問ではない(一般チャットへフォールスルー)。
  // ただしT5/次元不足等で needClarify だけ来る場合は、分析質問"だが曖昧"のケースとして扱う。
  plan = raw && raw.needClarify ? needClarify(String(raw.needClarify)) : { isBiQuestion: false };
} else {
  const invalidMsg = validateShape(raw.template, raw.metric, raw.dimension, raw.dimensionB);
  if (invalidMsg) {
    plan = needClarify(invalidMsg);
  } else {
    plan = {
      isBiQuestion: true,
      op: "query",
      template: raw.template,
      metric: raw.metric,
      dimension: raw.dimension || undefined,
      dimensionB: raw.dimensionB || undefined,
      period: PERIODS.indexOf(raw.period) !== -1 ? raw.period : "current_fiscal_year",
      filters: sanitizeFilters(raw.filters),
      needClarify: null,
    };
  }
}

return [{ json: { ...original, biPlan: plan } }];
`.trim(),
      },
    },
    {
      id: 'is_bi_question_if',
      name: 'Is BI Question?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextBiPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{ !!$json.biPlan.isBiQuestion }}', value2: true }],
        },
      },
    },
    {
      id: 'needs_bi_clarify_if',
      name: 'Needs BI Clarify?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextBiPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{ !$json.biPlan.template }}', value2: true }],
        },
      },
    },
    {
      id: 'format_bi_clarify',
      name: 'Format BI Clarify',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
const original = $json;
return [{ json: {
  response: {
    answer: (original.biPlan && original.biPlan.needClarify) || "もう少し詳しく教えていただけますか?",
    referencedRecords: [],
    action: null,
    prefill: {},
  },
  sessionId: original.sessionId || "",
  userId: original.userId || "",
  userName: original.userName || "",
  message: original.message || "",
} }];
`.trim(),
      },
    },
    {
      id: 'is_narrate_if',
      name: 'Is Narrate?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextBiPos(),
      parameters: {
        // narrate(直前のカードについて話す)は新しい集計を一切行わない——Fetch BI
        // Opportunities/Leads・Aggregate BI を丸ごとバイパスし、currentCardの確定済み
        // データだけを引き継ぐ(RELVA BI 追加要件定義書 §4)。
        conditions: {
          boolean: [{ value1: '={{ $json.biPlan.op === "narrate" }}', value2: true }],
        },
      },
    },
    {
      id: 'build_narrate_input',
      name: 'Build Narrate Input',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
${aggregateEmbeddable()}

const original = $node["Parse BI Plan"].json;
const plan = original.biPlan;
const currentCard = original.currentCard || null;

// Parse BI PlanでcurrentCard.templateの有無は既に確認済みだが、dataが欠けているケース
// (フロントエンドの状態が壊れている等)は防御的にここでもう一度弾く。
if (!currentCard || !currentCard.data) {
  return [{ json: { ...original, biAggregateError: "直前のグラフのデータが見つかりませんでした。もう一度質問し直してください。" } }];
}

// 新しい集計は一切行わない —— currentCardが既に持っている確定済みの表示結果をそのまま使う。
const biResult = {
  template: currentCard.template,
  title: currentCard.title || "",
  interpretation: currentCard.interpretation || "",
  filtersApplied: currentCard.filtersApplied || [],
  data: currentCard.data,
  narrative: "",
};

// factSheetの整形はAggregate BIと全く同じ関数を使う(表示の一貫性・"LLMに計算させない"
// 原則を経路によらず保つため——aggregateEmbeddable()経由でbuildFactSheetは既に埋め込み済み)。
const factSheet = buildFactSheet(currentCard.template, plan.metric, biResult.title, currentCard.data);

return [{ json: { ...original, biResult, factSheet } }];
`.trim(),
      },
    },
    {
      id: 'check_dataset_cache',
      name: 'Check Dataset Cache',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        // RELVA BI 追加要件定義書 §7 — query/refineのたび毎回kintoneへ500件フェッチし直すのを
        // 避けるためのキャッシュ。無効化は本来kintoneのWebhook(sync-workflow.ts)で即時に行う
        // 想定だが、そのWebhookがkintone管理画面で実際に登録されているかはこちらのコードから
        // 保証できない(登録は手動作業 — README参照)ため、5分のTTLを保険として併設する
        // (webhookが効いていれば即時反映、登録漏れでも最悪5分で自動復旧する)。
        method: 'GET',
        url: `${config.supabaseUrl}/rest/v1/dataset_cache`,
        sendHeaders: true,
        headerParameters: { parameters: supabaseHeaders() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'cache_key', value: 'in.(opportunity_records,lead_records)' },
            { name: 'computed_at', value: '={{ "gt." + new Date(Date.now() - 5 * 60 * 1000).toISOString() }}' },
            { name: 'select', value: 'cache_key,data' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'collect_dataset_cache_rows',
      name: 'Collect Dataset Cache Rows',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        // PostgRESTはJSON配列をそのまま返すが、n8nのHTTP Requestノードは配列レスポンスを
        // 1件ずつ別アイテムに分割する(Supabase Feedback Searchノードの既存コメントと同じ
        // 挙動)。そのため後続のDataset Cache Hit?で$json.lengthを見ても常に単一行オブジェクト
        // (配列ではない)しか見えず、キャッシュが実際にヒットしていても誤ってミス判定される
        // ——ここで元の配列に戻し、1回だけ判定できるようにする(n8nのCode nodeはjsonの値が
        // 直接配列だと拒否するため、{rows: [...]}のように1段オブジェクトで包む)。
        mode: 'runOnceForAllItems',
        jsCode: 'return [{ json: { rows: $input.all().map((item) => item.json) } }];',
      },
    },
    {
      id: 'dataset_cache_hit_if',
      name: 'Dataset Cache Hit?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextBiPos(),
      parameters: {
        // 案件・リード両方のキャッシュ行が(TTL内で)揃っている場合のみヒットとする——
        // 無効化は3アプリ(取引先/案件/リード)いずれかの変更で両方まとめて消す設計のため、
        // 部分的な片方だけヒットは想定しない(Supabase障害時など$jsonが配列でない場合も
        // ここで安全にミスとして扱われる)。
        conditions: {
          boolean: [{ value1: '={{ Array.isArray($json.rows) && $json.rows.length === 2 }}', value2: true }],
        },
      },
    },
    {
      id: 'use_cached_datasets',
      name: 'Use Cached Datasets',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
const original = $node["Parse BI Plan"].json;
const rows = Array.isArray($json.rows) ? $json.rows : [];
const byKey = {};
for (const r of rows) byKey[r.cache_key] = r.data;
const opportunityRecords = byKey.opportunity_records || [];
const leadRecords = byKey.lead_records || [];
return [{ json: { ...original, opportunityRecords, leadRecords } }];
`.trim(),
      },
    },
    {
      id: 'fetch_bi_opportunities',
      name: 'Fetch BI Opportunities',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.opportunityApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            // Search Opportunity Owners と同じ「デモ規模なら500件で足りる」前提の全件取得
            // (別ブランチのため専用ノードとして持つ — 既存チェーンには触れない)。
            { name: 'query', value: 'limit 500' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'fetch_bi_leads',
      name: 'Fetch BI Leads',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.leadApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.leadAppId) },
            { name: 'query', value: 'limit 500' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'write_dataset_cache',
      name: 'Write Dataset Cache',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      parameters: {
        method: 'POST',
        url: `${config.supabaseUrl}/rest/v1/dataset_cache`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...supabaseHeaders(), { name: 'Prefer', value: 'resolution=merge-duplicates,return=minimal' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify([
  { cache_key: "opportunity_records", template: "opportunity_records", params: {}, data: $node["Fetch BI Opportunities"].json.records || [], computed_at: new Date().toISOString() },
  { cache_key: "lead_records", template: "lead_records", params: {}, data: $json.records || [], computed_at: new Date().toISOString() }
]) }}`,
        options: {},
      },
    },
    {
      id: 'build_fetched_datasets',
      name: 'Build Fetched Datasets',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
const original = $node["Parse BI Plan"].json;
const opportunityRecords = $node["Fetch BI Opportunities"].json.records || [];
const leadRecords = $node["Fetch BI Leads"].json.records || [];
return [{ json: { ...original, opportunityRecords, leadRecords } }];
`.trim(),
      },
    },
    {
      id: 'prepare_bi_datasets',
      name: 'Prepare BI Datasets',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        // Use Cached Datasets(キャッシュヒット)とBuild Fetched Datasets(キャッシュミス→
        // kintoneから取得)という2つの異なるノードの出力を、Aggregate BIが1つの安定した名前で
        // 参照できるように集約する恒等ノード。Prepare Final Response / Prepare BI Narrative
        // Input と全く同じパターン。
        jsCode: 'return [{ json: $json }];',
      },
    },
    {
      id: 'aggregate_bi',
      name: 'Aggregate BI',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
${aggregateEmbeddable()}
${fiscalEmbeddable()}

const original = $node["Parse BI Plan"].json;
const plan = original.biPlan;

// キャッシュヒット(Use Cached Datasets)・ミス(Build Fetched Datasets)のどちらが実行された
// かに関わらず、必ず Prepare BI Datasets(集約ノード)を経由した名前で参照する。
const opportunityRecords = $node["Prepare BI Datasets"].json.opportunityRecords || [];
const leadRecords = $node["Prepare BI Datasets"].json.leadRecords || [];

// 期間解決(fiscal.ts)・集計(runAggregate)・interpretation/factSheetの組み立てまでを
// buildBiResult()(aggregateEmbeddable経由で埋め込み済み)にまとめている——
// src/customize/dashboard.ts(初期ダッシュボード)もこの同じ関数を直接importして使うため、
// この経路と集計ロジック・表示フォーマットが分岐/重複することはない(§6-3)。
const outcome = buildBiResult({ opportunityRecords, leadRecords }, plan, new Date(), resolvePeriodPreset);

if (!outcome.ok) {
  return [{ json: { ...original, biAggregateError: outcome.message } }];
}

return [{ json: { ...original, biResult: outcome.biResult, factSheet: outcome.factSheet } }];
`.trim(),
      },
    },
    {
      id: 'prepare_bi_narrative_input',
      name: 'Prepare BI Narrative Input',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        // Aggregate BI(query/refine)とBuild Narrate Input(narrate)という2つの異なる
        // ノードの出力を、後続(BI Narrative/Format BI Response)が1つの安定した名前で
        // 参照できるように集約する恒等ノード。Prepare Final Response と全く同じパターン
        // (実行されなかった方のノード名を直接参照するとエラーになるため)。
        jsCode: 'return [{ json: $json }];',
      },
    },
    {
      id: 'bi_aggregate_ok_if',
      name: 'BI Aggregate OK?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextBiPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{ !!$json.biResult }}', value2: true }],
        },
      },
    },
    {
      id: 'format_bi_error',
      name: 'Format BI Error',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
const original = $json;
return [{ json: {
  response: {
    answer: original.biAggregateError || "集計中にエラーが発生しました。",
    referencedRecords: [],
    action: null,
    prefill: {},
  },
  sessionId: original.sessionId || "",
  userId: original.userId || "",
  userName: original.userName || "",
  message: original.message || "",
} }];
`.trim(),
      },
    },
    {
      id: 'bi_narrative',
      name: 'BI Narrative',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextBiPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        // biResult をそのまま渡さない(円の生数値を渡すとLLMが自分で万円換算して桁を間違える
        // ——実際に本番で発生した)。Aggregate BI/Build Narrate Input が組み立てた表示確定済みの
        // factSheet だけを渡す。query/refine/narrateのどれが実行されたかに関わらず、必ず
        // Prepare BI Narrative Input(集約ノード)を経由した名前で参照する。
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(BI_NARRATIVE_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ title: $node["Prepare BI Narrative Input"].json.biResult.title, interpretation: $node["Prepare BI Narrative Input"].json.biResult.interpretation, factSheet: $node["Prepare BI Narrative Input"].json.factSheet }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'format_bi_response',
      name: 'Format BI Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        jsCode: `
// query/refine/narrateのどれが実行されたかに関わらず、Prepare BI Narrative Input(集約
// ノード)経由で参照する——実行されなかった方の枝のノード名(Aggregate BI等)を直接
// 参照するとエラーになるため。
const original = $node["Prepare BI Narrative Input"].json;
let narrative = "";
try {
  const parsed = JSON.parse($json.choices[0].message.content);
  narrative = typeof parsed.narrative === "string" ? parsed.narrative : "";
} catch (e) {
  narrative = "";
}
const biResult = { ...original.biResult, narrative: narrative || original.biResult.interpretation };
const plan = original.biPlan || {};
// カード=テンプレインスタンス統一モデル(RELVA BI 追加要件定義書 §3): このカードが
// どのtemplate/paramsから作られたかをcardSpecとしてフロントエンドへ返す。フロント
// エンドはこれをcurrentCardとして保持し、次のrefine/narrateリクエストに載せて送り返す。
const cardSpec = {
  template: biResult.template,
  params: {
    metric: plan.metric,
    dimension: plan.dimension,
    dimensionB: plan.dimensionB,
    filters: plan.filters || [],
    period: plan.period ? { preset: plan.period } : undefined,
  },
  title: biResult.title,
  interpretation: biResult.interpretation,
  filtersApplied: biResult.filtersApplied,
  data: biResult.data,
};
return [{ json: {
  response: {
    answer: biResult.interpretation + (narrative ? " " + narrative : ""),
    biResult,
    cardSpec,
    referencedRecords: [],
    action: null,
    prefill: {},
  },
  sessionId: original.sessionId || "",
  userId: original.userId || "",
  userName: original.userName || "",
  message: original.message || "",
} }];
`.trim(),
      },
    },
    // ---- RELVA BI サブグラフ終了 ----
    {
      id: 'prepare_final_response',
      name: 'Prepare Final Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextBiPos(),
      parameters: {
        // 一般チャット経路(Format Response)とBI経路(Format BI Clarify/Response/Error)の
        // 4つの終端ノードを1つの安定した名前に集約する恒等ノード。Respond to Webhook が
        // 特定ノード名を直接参照する既存の実装のままだと、実行されなかった方のブランチの
        // ノード名を参照してエラーになるため、この1ホップだけ挟んで解決する。
        jsCode: 'return [{ json: $json }];',
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
        // RELVA BI 追加以前は Feedback Check? から直接この Query Planner に繋がっていたため
        // $json が生のwebhookペイロード({body:{...}})のままだった。今は BI Router → Parse BI
        // Plan(bodyをフラット化して返す)を経由するため、$json.body は無くなっている——
        // Parse Query Plan が既に同じ理由で $node["Verify Secret"].json.body を直接読んでいる
        // のと同じパターンに合わせ、predecessorの形に依存しないようにする。
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(PLANNER_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $node["Verify Secret"].json.body.message, history: ($node["Verify Secret"].json.body.history || []).slice(-6) }) } ] }) }}`,
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
  plan = { searchTerms: original.message ? [original.message] : [], intent: 'chat', needsWebSearch: false, webQuery: '' };
}

const terms = (Array.isArray(plan.searchTerms) ? plan.searchTerms : []).filter(Boolean).slice(0, 3);
const esc = (s) => String(s).replace(/"/g, '');
// Builds the actual kintone query string here (once, in code) instead of duplicating this
// escaping/OR-ing logic inline in 3 separate HTTP node expressions. A multi-entity question
// ("桜商事と山田製作所とみらい建設工業を比較して") previously only ever searched the FIRST
// extracted term — the other companies' deals were silently never fetched, and the AI then
// wrongly concluded they "don't exist in the data". Each term now gets its own OR'd clause
// across the relevant fields, and the sample size scales with the number of terms so multiple
// companies' deals aren't squeezed out of the same fixed 5-record cap.
function buildQuery(fields, limit) {
  if (!terms.length) return 'limit ' + limit;
  const clauses = terms.map((t) => '(' + fields.map((f) => f + ' like "' + esc(t) + '"').join(' or ') + ')');
  return clauses.join(' or ') + ' limit ' + limit;
}
const sampleLimit = terms.length > 1 ? Math.min(5 * terms.length, 30) : 5;
plan.accountQuery = buildQuery(['company_name', 'contact_name'], sampleLimit);
plan.opportunityQuery = buildQuery(['deal_name', 'account', 'owner'], sampleLimit);
plan.leadQuery = buildQuery(['lead_name', 'company_name'], sampleLimit);

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
            { name: 'query', value: '={{ $json.plan.accountQuery }}' },
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
            // owner is included alongside deal_name/account so that "飯田が担当している案件は
            // いくつ?"-style questions (a person's name) actually filter by the assignee, instead
            // of only matching deal/company names and silently falling through to an unfiltered
            // "limit 5" that made every such question answer with the sample size.
            { name: 'query', value: '={{ $node["Parse Query Plan"].json.plan.opportunityQuery }}' },
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
            { name: 'query', value: '={{ $node["Parse Query Plan"].json.plan.leadQuery }}' },
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
              // +9h before slicing so this matches the JST calendar date daily-advice-workflow.ts
              // actually writes advice_date as (see that file's comment on the same fix) — without
              // it, this query used UTC's date and never found the record the 7:00 JST Cron had
              // just created that morning.
              name: 'query',
              value:
                '={{ "advice_date = \\"" + new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) + "\\" and assignee_code = \\"" + ($node["Parse Query Plan"].json.userCode || "").replace(/"/g, "") + "\\" limit 1" }}',
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
const stageCounts = {};
const allOpportunities = $node["Search Opportunity Owners"].json.records || [];
for (const r of allOpportunities) {
  const owner = (r.owner && r.owner.value) || "(未設定)";
  ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
  const stage = (r.stage && r.stage.value) || "(未設定)";
  stageCounts[stage] = (stageCounts[stage] || 0) + 1;
}
const opportunityByOwner = Object.entries(ownerCounts).map(([owner, count]) => ({ owner, count }));
// Fallback source for "今日やること" when the day's DailyAdvice hasn't been generated yet (the
// Cron only runs once a day — anyone asking before it fires that day gets an empty
// dailyAdviceRecords otherwise, with no path to a useful answer at all). Reuses the same
// full-record fetch above rather than a new query.
const userCode = original.userCode || "";
const CLOSED_STAGES = ["成約", "失注"];
const myOpenDeals = allOpportunities
  .filter((r) => (r.owner && r.owner.value) === userCode && !CLOSED_STAGES.includes((r.stage && r.stage.value) || ""))
  .sort((a, b) => String((a.close_date && a.close_date.value) || "9999").localeCompare(String((b.close_date && b.close_date.value) || "9999")))
  .slice(0, 5)
  .map((r) => ({
    dealName: (r.deal_name && r.deal_name.value) || "",
    account: (r.account && r.account.value) || "",
    stage: (r.stage && r.stage.value) || "",
    closeDate: (r.close_date && r.close_date.value) || "",
  }));
// Same full-record fetch as opportunityByOwner above (not a separate query) — "成約は何件?"
// style questions were being answered from the keyword-filtered 5-record sample's totalCount,
// which reflects a deal_name/account/owner text match against the stage NAME, not an actual
// stage filter, so it returned nonsense counts (e.g. "1件" when the real count was 3).
const opportunityByStage = Object.entries(stageCounts).map(([stage, count]) => ({ stage, count }));
const dailyAdviceRecords = $node["Search Daily Advice"].json.records || [];
return [{ json: {
  ...original,
  correctionContext,
  webSearchContext,
  manualContext,
  // The Main AI was repeatedly asked (via prompt instructions alone) to admit when a user has
  // neither a formal daily advice nor any open deals of their own, rather than borrowing another
  // assignee's deals from opportunityRecords — it kept doing so anyway across two rounds of
  // prompt strengthening. Format Response deterministically overrides the answer in this exact
  // case instead of continuing to rely on prompt compliance for a correctness-critical path.
  noDataForToday: dailyAdviceRecords.length === 0 && myOpenDeals.length === 0,
  kintoneContext: {
    accountRecords: ($node["Search Account"].json.records || []),
    accountTotalCount: Number($node["Search Account"].json.totalCount || 0),
    opportunityRecords: ($node["Search Opportunity"].json.records || []),
    opportunityTotalCount: Number($node["Search Opportunity"].json.totalCount || 0),
    leadRecords: ($node["Search Lead"].json.records || []),
    leadTotalCount: Number($node["Search Lead"].json.totalCount || 0),
    dailyAdviceRecords,
    salesScoreRecords: ($node["Search Sales Score"].json.records || []),
    opportunityByOwner,
    opportunityByStage,
    myOpenDeals,
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
const TODAY_TASK_KEYWORDS = /今日|本日|やること|タスク|優先/;
if (original.noDataForToday && TODAY_TASK_KEYWORDS.test(original.message || "")) {
  parsed = {
    answer: "本日分のアドバイスはまだ生成されておらず、現在担当している案件もないため、ご提案できる内容がありません。",
    referencedRecords: [],
    action: null,
    prefill: {},
  };
}
// An empty/whitespace-only message asked the model to answer *something* anyway a second time
// (first found and "fixed" via a prompt-only instruction earlier — it held up in isolated
// testing but stopped holding once the daily-advice fallback instructions were added later,
// since the model treated any input with no company/deal to key off of as an implicit "today's
// tasks" question when that data happened to be sitting right there in context). Emptiness is
// trivial to check deterministically, so this no longer depends on the model noticing on its own.
if (!(original.message || "").trim()) {
  parsed = { answer: "どのようなご質問でしょうか?", referencedRecords: [], action: null, prefill: {} };
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
        // Format Response(一般チャット)・Format BI Clarify/Response/Error(BI)のどれが
        // 実行されたかによらず、Prepare Final Response が常に1つに集約している。
        responseBody: '={{ $node["Prepare Final Response"].json.response }}',
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
        [{ node: 'BI Router', type: 'main', index: 0 }],
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
    // ---- RELVA BI (要件定義書 §5) サブグラフ ----
    'BI Router': { main: [[{ node: 'Parse BI Plan', type: 'main', index: 0 }]] },
    'Parse BI Plan': { main: [[{ node: 'Is BI Question?', type: 'main', index: 0 }]] },
    'Is BI Question?': {
      main: [
        [{ node: 'Needs BI Clarify?', type: 'main', index: 0 }],
        [{ node: 'Query Planner', type: 'main', index: 0 }],
      ],
    },
    'Needs BI Clarify?': {
      main: [
        [{ node: 'Format BI Clarify', type: 'main', index: 0 }],
        [{ node: 'Is Narrate?', type: 'main', index: 0 }],
      ],
    },
    'Format BI Clarify': { main: [[{ node: 'Prepare Final Response', type: 'main', index: 0 }]] },
    // narrate(直前のカードについて話す)は集計を一切バイパスする。query/refineは
    // Check Dataset Cache(§7 — TTL付きキャッシュ)を経由してからkintoneフェッチ/集計へ進む。
    'Is Narrate?': {
      main: [
        [{ node: 'Build Narrate Input', type: 'main', index: 0 }],
        [{ node: 'Check Dataset Cache', type: 'main', index: 0 }],
      ],
    },
    'Build Narrate Input': { main: [[{ node: 'Prepare BI Narrative Input', type: 'main', index: 0 }]] },
    'Check Dataset Cache': { main: [[{ node: 'Collect Dataset Cache Rows', type: 'main', index: 0 }]] },
    'Collect Dataset Cache Rows': { main: [[{ node: 'Dataset Cache Hit?', type: 'main', index: 0 }]] },
    'Dataset Cache Hit?': {
      main: [
        [{ node: 'Use Cached Datasets', type: 'main', index: 0 }],
        [{ node: 'Fetch BI Opportunities', type: 'main', index: 0 }],
      ],
    },
    'Use Cached Datasets': { main: [[{ node: 'Prepare BI Datasets', type: 'main', index: 0 }]] },
    'Fetch BI Opportunities': { main: [[{ node: 'Fetch BI Leads', type: 'main', index: 0 }]] },
    'Fetch BI Leads': { main: [[{ node: 'Write Dataset Cache', type: 'main', index: 0 }]] },
    'Write Dataset Cache': { main: [[{ node: 'Build Fetched Datasets', type: 'main', index: 0 }]] },
    'Build Fetched Datasets': { main: [[{ node: 'Prepare BI Datasets', type: 'main', index: 0 }]] },
    'Prepare BI Datasets': { main: [[{ node: 'Aggregate BI', type: 'main', index: 0 }]] },
    'Aggregate BI': { main: [[{ node: 'Prepare BI Narrative Input', type: 'main', index: 0 }]] },
    'Prepare BI Narrative Input': { main: [[{ node: 'BI Aggregate OK?', type: 'main', index: 0 }]] },
    'BI Aggregate OK?': {
      main: [
        [{ node: 'BI Narrative', type: 'main', index: 0 }],
        [{ node: 'Format BI Error', type: 'main', index: 0 }],
      ],
    },
    'Format BI Error': { main: [[{ node: 'Prepare Final Response', type: 'main', index: 0 }]] },
    'BI Narrative': { main: [[{ node: 'Format BI Response', type: 'main', index: 0 }]] },
    'Format BI Response': { main: [[{ node: 'Prepare Final Response', type: 'main', index: 0 }]] },
    // ---- RELVA BI サブグラフここまで ----
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
    // Format Response(一般チャット経路)と Format BI Clarify/Response/Error(BI経路)の
    // 4つの終端はすべて Prepare Final Response に合流させ、Respond to Webhook が参照する
    // ノード名を1つに固定する(詳細は Prepare Final Response ノードのコメント参照)。
    'Format Response': { main: [[{ node: 'Prepare Final Response', type: 'main', index: 0 }]] },
    'Prepare Final Response': { main: [[{ node: 'Save to Supabase', type: 'main', index: 0 }]] },
    'Save to Supabase': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: AGENT_WORKFLOW_NAME, nodes, connections };
}
