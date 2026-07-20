import type { KintoneFieldProperties } from '../lib/kintone-client';

function dropdownOptions(labels: string[]): Record<string, { label: string; index: string }> {
  return Object.fromEntries(labels.map((label, index) => [label, { label, index: String(index) }]));
}

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
    options: dropdownOptions([
      'IT・ソフトウェア',
      '製造',
      '小売・流通',
      '金融・保険',
      '医療・ヘルスケア',
      '建設・不動産',
      'サービス',
      'その他',
    ]),
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
    options: dropdownOptions(['見込み', '取引中', '休眠']),
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
    options: dropdownOptions(['名刺', '問い合わせフォーム', '紹介', 'その他']),
  },
  status: {
    type: 'DROP_DOWN',
    code: 'status',
    label: 'ステータス',
    options: dropdownOptions(['未対応', '対応中', '変換済み', '対象外']),
    defaultValue: '未対応',
  },
  memo: {
    type: 'MULTI_LINE_TEXT',
    code: 'memo',
    label: 'メモ',
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
      options: dropdownOptions([
        '初期接触',
        'ヒアリング',
        '提案中',
        '見積提出',
        '交渉中',
        '成約',
        '失注',
      ]),
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
  };
}
