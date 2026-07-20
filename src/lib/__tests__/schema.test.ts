import { describe, expect, it } from 'vitest';
import { ACCOUNT_FIELDS, CONVERSATION_LOG_FIELDS, buildOpportunityFields } from '../../apps/schema';

describe('ACCOUNT_FIELDS', () => {
  it('marks company_name as required and unique', () => {
    expect(ACCOUNT_FIELDS.company_name).toMatchObject({
      type: 'SINGLE_LINE_TEXT',
      required: true,
      unique: true,
    });
  });
});

describe('CONVERSATION_LOG_FIELDS', () => {
  it('defaults status to 完了 with only 完了/エラー as options', () => {
    const status = CONVERSATION_LOG_FIELDS.status as unknown as {
      defaultValue: string;
      options: Record<string, unknown>;
    };
    expect(status.defaultValue).toBe('完了');
    expect(Object.keys(status.options)).toEqual(['完了', 'エラー']);
  });
});

interface LookupField {
  type: string;
  lookup: {
    relatedApp: { app: number };
    relatedKeyField: string;
    lookupPickerFields: string[];
  };
}

describe('buildOpportunityFields', () => {
  it('wires the account LOOKUP field to the given account app id', () => {
    const fields = buildOpportunityFields(42);
    const account = fields.account as unknown as LookupField;

    expect(account.type).toBe('SINGLE_LINE_TEXT');
    expect(account.lookup.relatedApp.app).toBe(42);
    expect(account.lookup.relatedKeyField).toBe('company_name');
    expect(account.lookup.lookupPickerFields).toContain('company_name');
  });

  it('produces a different lookup target per account app id', () => {
    const fieldsA = buildOpportunityFields(1);
    const fieldsB = buildOpportunityFields(2);

    expect((fieldsA.account as unknown as LookupField).lookup.relatedApp.app).not.toBe(
      (fieldsB.account as unknown as LookupField).lookup.relatedApp.app,
    );
  });
});
