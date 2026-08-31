import { describe, expect, it } from 'vitest';
import { ACCOUNT_FIELDS, buildOpportunityFields } from '../../apps/schema';

describe('ACCOUNT_FIELDS', () => {
  it('marks company_name as required and unique', () => {
    expect(ACCOUNT_FIELDS.company_name).toMatchObject({
      type: 'SINGLE_LINE_TEXT',
      required: true,
      unique: true,
    });
  });
});

interface LookupField {
  type: string;
  lookup: {
    relatedApp: { app: number };
    relatedKeyField: string;
    lookupPickerFields: string[];
    fieldMappings?: { field: string; relatedField: string }[];
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

  it('copies 取引先.industry onto the opportunity record via fieldMappings (RELVA BI 要件定義書 §2)', () => {
    const fields = buildOpportunityFields(42);
    const account = fields.account as unknown as LookupField;

    expect(account.lookup.fieldMappings).toEqual([{ field: 'industry', relatedField: 'industry' }]);
    expect(fields.industry).toMatchObject({ type: 'SINGLE_LINE_TEXT' });
    expect(fields.loss_reason).toMatchObject({ type: 'DROP_DOWN' });
  });

  it('produces a different lookup target per account app id', () => {
    const fieldsA = buildOpportunityFields(1);
    const fieldsB = buildOpportunityFields(2);

    expect((fieldsA.account as unknown as LookupField).lookup.relatedApp.app).not.toBe(
      (fieldsB.account as unknown as LookupField).lookup.relatedApp.app,
    );
  });
});
