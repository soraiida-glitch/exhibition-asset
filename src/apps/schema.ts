import type { KintoneFieldProperties } from '../lib/kintone-client';

function dropdownOptions(labels: string[]): Record<string, { label: string; index: string }> {
  return Object.fromEntries(labels.map((label, index) => [label, { label, index: String(index) }]));
}

// Exported so the AI agent's prompt (src/workflows/agent-workflow.ts) can enumerate the exact
// valid values instead of drifting out of sync with a second hardcoded copy — kintone rejects
// any DROP_DOWN value that isn't byte-for-byte one of these (CB_VA01 "not in options").
export const ACCOUNT_INDUSTRY_OPTIONS = [
  'IT・ソフトウェア',
  '製造',
  '小売・流通',
  '金融・保険',
  '医療・ヘルスケア',
  '建設・不動産',
  'サービス',
  'その他',
];
export const ACCOUNT_STATUS_OPTIONS = ['見込み', '取引中', '休眠'];
export const LEAD_SOURCE_OPTIONS = ['名刺', '問い合わせフォーム', '紹介', 'その他'];
export const LEAD_STATUS_OPTIONS = ['未対応', '対応中', '変換済み', '対象外'];
export const OPPORTUNITY_STAGE_OPTIONS = [
  '初期接触',
  'ヒアリング',
  '提案中',
  '見積提出',
  '交渉中',
  '成約',
  '失注',
];

/** exhibition_取引先 (Account) — minimal first-pass schema; detailed field design deferred per requirements doc. */
export const ACCOUNT_FIELDS: KintoneFieldProperties = {
  company_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'company_name',
    label: '会社名',
    required: true,
    unique: true, // must be unique before exhibition_案件's LOOKUP can reference it
  },
  industry: {
    type: 'DROP_DOWN',
    code: 'industry',
    label: '業種',
    options: dropdownOptions(ACCOUNT_INDUSTRY_OPTIONS),
  },
  contact_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'contact_name',
    label: '担当者名',
  },
  phone: {
    type: 'SINGLE_LINE_TEXT',
    code: 'phone',
    label: '電話番号',
  },
  email: {
    type: 'SINGLE_LINE_TEXT',
    code: 'email',
    label: 'メールアドレス',
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    options: dropdownOptions(ACCOUNT_STATUS_OPTIONS),
    defaultValue: '見込み',
  },
  memo: {
    type: 'MULTI_LINE_TEXT',
    code: 'memo',
    label: 'メモ',
  },
};

/** exhibition_リード (Lead) — company_name is intentionally free text, not linked to 取引先; dedup is phase-3 scope. */
export const LEAD_FIELDS: KintoneFieldProperties = {
  lead_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'lead_name',
    label: '氏名',
    required: true,
  },
  company_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'company_name',
    label: '会社名',
  },
  phone: {
    type: 'SINGLE_LINE_TEXT',
    code: 'phone',
    label: '電話番号',
  },
  email: {
    type: 'SINGLE_LINE_TEXT',
    code: 'email',
    label: 'メールアドレス',
  },
  source: {
    type: 'DROP_DOWN',
    code: 'source',
    label: '流入経路',
    options: dropdownOptions(LEAD_SOURCE_OPTIONS),
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    options: dropdownOptions(LEAD_STATUS_OPTIONS),
    defaultValue: '未対応',
  },
  memo: {
    type: 'MULTI_LINE_TEXT',
    code: 'memo',
    label: 'メモ',
  },
};

/** exhibition_秘書AI会話ログ — audit/history log for the AI agent; the chat UI responds synchronously and does not poll this app. */
export const CONVERSATION_LOG_FIELDS: KintoneFieldProperties = {
  session_id: {
    type: 'SINGLE_LINE_TEXT',
    code: 'session_id',
    label: 'セッションID',
  },
  user_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'user_name',
    label: 'ユーザー名',
  },
  message: {
    type: 'MULTI_LINE_TEXT',
    code: 'message',
    label: 'メッセージ',
  },
  ai_answer: {
    type: 'MULTI_LINE_TEXT',
    code: 'ai_answer',
    label: 'AI応答',
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    options: dropdownOptions(['完了', 'エラー']),
    defaultValue: '完了',
  },
  error_message: {
    type: 'MULTI_LINE_TEXT',
    code: 'error_message',
    label: 'エラーメッセージ',
  },
};

/**
 * exhibition_案件 (Opportunity). Needs the already-*deployed* (live) 取引先 app id,
 * since the LOOKUP field references it — must be built after exhibition_取引先 is live.
 */
export function buildOpportunityFields(accountAppId: number): KintoneFieldProperties {
  return {
    deal_name: {
      type: 'SINGLE_LINE_TEXT',
      code: 'deal_name',
      label: '案件名',
      required: true,
    },
    account: {
      type: 'SINGLE_LINE_TEXT',
      code: 'account',
      label: '取引先',
      lookup: {
        relatedApp: { app: accountAppId },
        relatedKeyField: 'company_name',
        lookupPickerFields: ['company_name', 'industry', 'contact_name'],
      },
    },
    amount: {
      type: 'NUMBER',
      code: 'amount',
      label: '金額(円)',
    },
    stage: {
      type: 'DROP_DOWN',
      code: 'stage',
      label: 'フェーズ',
      options: dropdownOptions(OPPORTUNITY_STAGE_OPTIONS),
      defaultValue: '初期接触',
    },
    close_date: {
      type: 'DATE',
      code: 'close_date',
      label: 'クロージング予定日',
    },
    owner: {
      type: 'SINGLE_LINE_TEXT',
      code: 'owner',
      label: '担当者',
    },
    description: {
      type: 'MULTI_LINE_TEXT',
      code: 'description',
      label: '概要',
    },
    closing_advice: {
      type: 'MULTI_LINE_TEXT',
      code: 'closing_advice',
      label: 'クロージングアドバイス(JSON)',
    },
    customer_issue: {
      type: 'MULTI_LINE_TEXT',
      code: 'customer_issue',
      label: '顧客の課題',
    },
    meeting_notes: {
      type: 'MULTI_LINE_TEXT',
      code: 'meeting_notes',
      label: '商談メモ',
    },
  };
}

/**
 * exhibition_ロールプレイセッション — one record per finished roleplay practice run (phase 5),
 * written by the roleplay workflow's feedback step. The conversation itself is held client-side
 * and never persisted mid-session; only the final transcript + feedback are saved here.
 */
export const ROLEPLAY_SESSION_FIELDS: KintoneFieldProperties = {
  deal_record_id: {
    type: 'SINGLE_LINE_TEXT',
    code: 'deal_record_id',
    label: '案件レコードID',
  },
  deal_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'deal_name',
    label: '案件名',
  },
  trainee_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'trainee_name',
    label: '練習者名',
  },
  roleplay_datetime: {
    type: 'DATETIME',
    code: 'roleplay_datetime',
    label: '実施日時',
  },
  ai_persona: {
    type: 'MULTI_LINE_TEXT',
    code: 'ai_persona',
    label: '顧客ペルソナ(JSON)',
  },
  conversation_log: {
    type: 'MULTI_LINE_TEXT',
    code: 'conversation_log',
    label: '会話ログ',
  },
  feedback: {
    type: 'MULTI_LINE_TEXT',
    code: 'feedback',
    label: 'フィードバック(JSON)',
  },
  total_score: {
    type: 'NUMBER',
    code: 'total_score',
    label: '総合スコア',
  },
  hearing_score: {
    type: 'NUMBER',
    code: 'hearing_score',
    label: 'ヒアリング力',
  },
  issue_score: {
    type: 'NUMBER',
    code: 'issue_score',
    label: '課題理解力',
  },
  proposal_score: {
    type: 'NUMBER',
    code: 'proposal_score',
    label: '提案力',
  },
  objection_score: {
    type: 'NUMBER',
    code: 'objection_score',
    label: '反論対応力',
  },
  closing_score: {
    type: 'NUMBER',
    code: 'closing_score',
    label: 'クロージング力',
  },
  good_points: {
    type: 'MULTI_LINE_TEXT',
    code: 'good_points',
    label: '良かった点',
  },
  improvement_points: {
    type: 'MULTI_LINE_TEXT',
    code: 'improvement_points',
    label: '改善点',
  },
  next_training_theme: {
    type: 'SINGLE_LINE_TEXT',
    code: 'next_training_theme',
    label: '次回の練習テーマ',
  },
};

export const DAILY_ADVICE_STATUS_OPTIONS = ['完了', 'エラー'];

/**
 * exhibition_デイリーアドバイス — one record per (advice_date, assignee_code), written by the
 * daily cron workflow. Every field here is actually written by that workflow — Relava's
 * equivalent app had a `status`/`completion_rate` pair defined but never populated; we don't
 * define fields we don't intend to write.
 */
export const DAILY_ADVICE_FIELDS: KintoneFieldProperties = {
  advice_date: {
    type: 'DATE',
    code: 'advice_date',
    label: '対象日',
  },
  assignee_code: {
    type: 'SINGLE_LINE_TEXT',
    code: 'assignee_code',
    label: '担当者コード',
  },
  assignee_name: {
    type: 'SINGLE_LINE_TEXT',
    code: 'assignee_name',
    label: '担当者名',
  },
  context_summary: {
    type: 'MULTI_LINE_TEXT',
    code: 'context_summary',
    label: 'コンテキストサマリー',
  },
  advice_json: {
    type: 'MULTI_LINE_TEXT',
    code: 'advice_json',
    label: 'AIアドバイス(JSON)',
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    options: dropdownOptions(DAILY_ADVICE_STATUS_OPTIONS),
    defaultValue: '完了',
  },
};
