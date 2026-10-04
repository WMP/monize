import { describe, it, expect } from 'vitest';
import {
  blankCategoryRule,
  buildParserDefinition,
  buildParserPayload,
  definitionToFormFields,
  emptyParserForm,
  formCanRepresent,
  formatDefinitionJson,
  parseDefinitionJson,
  parseValidationProblems,
  parserToForm,
  splitDomains,
  splitLines,
  splitWords,
} from './receipt-parser-form';
import type { EmailReceiptParser } from '@/types/email-receipts';

const CATEGORY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('splitting', () => {
  it('splits patterns by line only, so a comma stays in the pattern', () => {
    expect(splitLines('Total: {amount}, tax\r\n\n  Sum {amount}  \n')).toEqual(['Total: {amount}, tax', 'Sum {amount}']);
  });

  it('splits subject words by line or comma', () => {
    expect(splitWords('order confirmation, your receipt\nthanks')).toEqual([
      'order confirmation',
      'your receipt',
      'thanks',
    ]);
  });

  it('splits domains by whitespace, comma or semicolon and drops a pasted @', () => {
    expect(splitDomains('@shop.example.com; other.example\nthird.example, ')).toEqual([
      'shop.example.com',
      'other.example',
      'third.example',
    ]);
  });
});

describe('buildParserDefinition', () => {
  it('is only the version for an empty form', () => {
    expect(buildParserDefinition(emptyParserForm())).toEqual({ version: 2 });
  });

  it('builds every part of the definition', () => {
    const definition = buildParserDefinition(
      emptyParserForm({
        orderId: 'Order {orderid}',
        total: 'Total {amount}\nGrand total {amount}',
        shipping: 'Shipping {amount}',
        discount: 'Discount {amount}',
        startAfter: ' Items ',
        stopAt: 'Subtotal',
        itemPatterns: '{name} x {qty} {price}',
        categoryRules: [
          { uid: 'a', match: ' *cable* ', categoryId: CATEGORY },
          { uid: 'b', match: '', categoryId: '' },
        ],
        defaultCategoryId: CATEGORY,
        shippingCategoryId: OTHER,
      }),
    );
    expect(definition).toEqual({
      version: 2,
      orderId: ['Order {orderid}'],
      total: ['Total {amount}', 'Grand total {amount}'],
      shipping: ['Shipping {amount}'],
      discount: ['Discount {amount}'],
      items: { startAfter: 'Items', stopAt: 'Subtotal', patterns: ['{name} x {qty} {price}'] },
      categoryRules: [{ match: '*cable*', categoryId: CATEGORY }],
      defaultCategoryId: CATEGORY,
      shippingCategoryId: OTHER,
    });
  });

  it('sends items with no patterns when only a marker is filled, so the server reports it', () => {
    expect(buildParserDefinition(emptyParserForm({ startAfter: 'Items' })).items).toEqual({
      startAfter: 'Items',
      patterns: [],
    });
  });

  it('keeps a half-filled category rule so the server reports the missing half', () => {
    const definition = buildParserDefinition(
      emptyParserForm({ categoryRules: [{ uid: 'a', match: '*x*', categoryId: '' }] }),
    );
    expect(definition.categoryRules).toEqual([{ match: '*x*', categoryId: '' }]);
  });
});

describe('buildParserPayload', () => {
  it('trims the name, nulls a blank payee and splits the lists', () => {
    const payload = buildParserPayload(
      emptyParserForm({
        name: '  Shop  ',
        fromDomains: 'shop.example.com',
        subjectContains: 'order, receipt',
        total: 'Total {amount}',
      }),
    );
    expect(payload).toEqual({
      name: 'Shop',
      payeeId: null,
      fromDomains: ['shop.example.com'],
      subjectContains: ['order', 'receipt'],
      definition: { version: 2, total: ['Total {amount}'] },
    });
  });

  it('carries the chosen payee', () => {
    expect(buildParserPayload(emptyParserForm({ name: 'x', payeeId: CATEGORY })).payeeId).toBe(CATEGORY);
  });
});

describe('parserToForm', () => {
  const parser = (overrides: Partial<EmailReceiptParser> = {}): EmailReceiptParser => ({
    id: 'p-1',
    name: 'Shop',
    payeeId: null,
    fromDomains: ['shop.example.com', 'mail.shop.example.com'],
    subjectContains: ['order'],
    definition: {
      version: 2,
      orderId: ['Order {orderid}'],
      total: ['Total {amount}'],
      items: { startAfter: 'Items', stopAt: 'Subtotal', patterns: ['{name} {amount}'] },
      categoryRules: [{ match: '*cable*', categoryId: CATEGORY }],
      defaultCategoryId: CATEGORY,
    },
    definitionValid: true,
    definitionErrors: [],
    status: 'approved',
    source: 'manual',
    approvedAt: null,
    revision: 2,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  });

  it('round-trips a stored parser through the form to the same definition', () => {
    const stored = parser();
    const form = parserToForm(stored);
    expect(form.fromDomains).toBe('shop.example.com\nmail.shop.example.com');
    expect(form.categoryRules).toHaveLength(1);
    expect(buildParserDefinition(form)).toEqual(stored.definition);
  });

  it('reads a definition restored as {} as an empty form, never a crash', () => {
    const form = parserToForm(parser({ definition: {}, definitionValid: false }));
    expect(buildParserDefinition(form)).toEqual({ version: 2 });
  });

  it('ignores parts of the wrong shape', () => {
    const form = parserToForm(
      parser({ definition: { total: 'not a list', items: [], categoryRules: [1, null, { match: 5 }] } }),
    );
    expect(form.total).toBe('');
    expect(form.itemPatterns).toBe('');
    expect(form.categoryRules).toHaveLength(1);
  });

  it('gives each category rule row its own key', () => {
    const a = blankCategoryRule();
    const b = blankCategoryRule();
    expect(a.uid).not.toBe(b.uid);
  });
});

describe('parseValidationProblems', () => {
  it('reads the problems a 400 lists', () => {
    expect(
      parseValidationProblems(
        'The parser definition is not valid: total[0]: capture_missing; items.patterns[1]: capture_conflict; categoryRules[2].categoryId: invalid_uuid; (definition): not_object',
      ),
    ).toEqual([
      { path: 'total[0]', code: 'capture_missing' },
      { path: 'items.patterns[1]', code: 'capture_conflict' },
      { path: 'categoryRules[2].categoryId', code: 'invalid_uuid' },
      { path: '', code: 'not_object' },
    ]);
  });

  it('reads a path that has no index', () => {
    expect(parseValidationProblems('x: items.patterns: empty')).toEqual([{ path: 'items.patterns', code: 'empty' }]);
  });

  it('is empty when the message lists none', () => {
    expect(parseValidationProblems('Payee not found')).toEqual([]);
  });
});

describe('formCanRepresent', () => {
  it('shows a definition of plain line patterns, whatever its version, and an empty one', () => {
    expect(formCanRepresent({})).toBe(true);
    expect(formCanRepresent({ version: 1, total: ['Total {amount}'] })).toBe(true);
    expect(
      formCanRepresent({
        version: 2,
        orderId: ['*#{orderid}'],
        total: ['Total {amount}'],
        items: { startAfter: 'Items', stopAt: 'Subtotal', patterns: ['{name} {amount}'] },
        categoryRules: [{ match: '*cable*', categoryId: CATEGORY }],
        defaultCategoryId: CATEGORY,
        shippingCategoryId: OTHER,
      }),
    ).toBe(true);
  });

  it.each([
    ['a labelled entry', { version: 2, total: [{ label: 'RAZEM', value: '{amount} zł' }] }],
    ['a labelled order id', { version: 2, orderId: ['*#{orderid}', { label: 'N', value: '{orderid}' }] }],
    ['multi-line items', { version: 2, items: { record: [{ line: '{name}' }, { line: '{amount}' }] } }],
    ['skipLines', { version: 2, items: { skipLines: ['<*>'], patterns: ['{name} {amount}'] } }],
    ['paid', { version: 2, paid: ['Zapłacono {amount}'] }],
    ['a payee', { version: 2, payee: ['Sprzedawca: {payee}'] }],
    ['a line guard', { version: 2, requireLine: ['*PayU*'] }],
    ['single items', { version: 2, items: { single: { name: 'Opis: {name}' } } }],
    ['joinWrapped', { version: 2, items: { patterns: ['{name} {amount} zł'], joinWrapped: true } }],
    ['a category rule field', { version: 2, categoryRules: [{ match: '*a*', categoryId: CATEGORY, field: 'payee' }] }],
    ['an unknown key', { version: 2, note: 'x' }],
    ['an unknown key under items', { version: 2, items: { patterns: ['{name} {amount}'], extra: 1 } }],
    ['a field that is not a list', { version: 2, total: 'Total {amount}' }],
    ['items that are not an object', { version: 2, items: [] }],
    ['a marker that is not text', { version: 2, items: { startAfter: 5, patterns: [] } }],
    ['a rule with an extra key', { version: 2, categoryRules: [{ match: 'x', categoryId: CATEGORY, extra: 1 }] }],
    ['categoryRules that is not a list', { version: 2, categoryRules: {} }],
    ['a default category that is not text', { version: 2, defaultCategoryId: 5 }],
    ['a definition that is not an object', [1]],
    ['null', null],
  ])('does not show %s: the form would drop it', (_label, definition) => {
    expect(formCanRepresent(definition)).toBe(false);
  });

  it('never drops what it says it can show: the round trip through the form is the definition', () => {
    const definition = {
      version: 2 as const,
      orderId: ['*#{orderid}'],
      total: ['Total {amount}', 'Sum {amount}'],
      shipping: ['Shipping {amount}'],
      discount: ['Discount {amount}'],
      items: { startAfter: 'Items', stopAt: 'Subtotal', patterns: ['{name} {amount}'] },
      categoryRules: [{ match: '*cable*', categoryId: CATEGORY }],
      defaultCategoryId: CATEGORY,
      shippingCategoryId: OTHER,
    };
    expect(formCanRepresent(definition)).toBe(true);
    const form = { ...emptyParserForm(), ...definitionToFormFields(definition) };
    expect(buildParserDefinition(form)).toEqual(definition);
  });
});

describe('the definition as JSON', () => {
  it('pretty-prints with two spaces, and an absent definition as {}', () => {
    expect(formatDefinitionJson({ version: 2, total: ['T {amount}'] })).toBe(
      '{\n  "version": 2,\n  "total": [\n    "T {amount}"\n  ]\n}',
    );
    expect(formatDefinitionJson(undefined)).toBe('{}');
  });

  it('keeps every version 2 field through a print and a parse', () => {
    const definition = {
      version: 2,
      total: [{ label: 'RAZEM', value: '{amount} zł', within: 3 }],
      items: {
        startAfter: 'od ',
        skipLines: ['<*>'],
        record: [{ line: '{name}' }, { line: '{amount} zł' }, { line: '{qty} × {price} zł', optional: true }],
      },
    };
    expect(parseDefinitionJson(formatDefinitionJson(definition))).toEqual({ ok: true, definition });
  });

  it.each([['not json'], ['[1, 2]'], ['"text"'], ['null'], ['5'], ['']])('refuses %j as a definition', (source) => {
    expect(parseDefinitionJson(source)).toEqual({ ok: false });
  });

  it('sends the JSON editor definition in the payload instead of the form', () => {
    const definition = { version: 2 as const, total: [{ label: 'RAZEM', value: '{amount} zł' }] };
    const payload = buildParserPayload({ ...emptyParserForm(), name: 'A', fromDomains: 'a.example' }, definition);
    expect(payload.definition).toBe(definition);
  });
});

describe('the server codes of version 2', () => {
  it('reads every new code out of a 400 message', () => {
    const message =
      'The parser definition is not valid: version: unsupported_version; total[0].within: out_of_range; items: items_patterns_and_record; items: items_shape_missing; items.skipLines: skip_lines_need_record; items.record: record_name_missing; items: items_single_conflict; items.joinWrapped: join_wrapped_needs_patterns; categoryRules[0].field: invalid_value';
    expect(parseValidationProblems(message)).toEqual([
      { path: 'version', code: 'unsupported_version' },
      { path: 'total[0].within', code: 'out_of_range' },
      { path: 'items', code: 'items_patterns_and_record' },
      { path: 'items', code: 'items_shape_missing' },
      { path: 'items.skipLines', code: 'skip_lines_need_record' },
      { path: 'items.record', code: 'record_name_missing' },
      { path: 'items', code: 'items_single_conflict' },
      { path: 'items.joinWrapped', code: 'join_wrapped_needs_patterns' },
      { path: 'categoryRules[0].field', code: 'invalid_value' },
    ]);
  });
});

describe('the lines source', () => {
  it('is the text by default, and is left out of the definition', () => {
    expect(emptyParserForm().source).toBe('text');
    expect(buildParserDefinition(emptyParserForm())).toEqual({ version: 2 });
  });

  it('writes source html only when the form says html', () => {
    expect(buildParserDefinition(emptyParserForm({ source: 'html' }))).toEqual({ version: 2, source: 'html' });
    expect(buildParserDefinition(emptyParserForm({ source: 'text' }))).not.toHaveProperty('source');
  });

  it('reads the source of a stored definition: html is html, anything else the text', () => {
    expect(definitionToFormFields({ version: 2, source: 'html' }).source).toBe('html');
    expect(definitionToFormFields({ version: 2, source: 'text' }).source).toBe('text');
    expect(definitionToFormFields({ version: 2 }).source).toBe('text');
    expect(definitionToFormFields({}).source).toBe('text');
  });

  it('can show a definition with a valid source, and not one with another', () => {
    expect(formCanRepresent({ version: 2, source: 'html', total: ['Total {amount}'] })).toBe(true);
    expect(formCanRepresent({ version: 2, source: 'text' })).toBe(true);
    expect(formCanRepresent({ version: 2, source: 'pdf' })).toBe(false);
    expect(formCanRepresent({ version: 2, source: 5 })).toBe(false);
  });

  it('round-trips an html parser through the form to the same definition', () => {
    const definition = { version: 2 as const, source: 'html' as const, total: ['Total {amount}'], items: { patterns: ['{name} {amount}'] } };
    expect(formCanRepresent(definition)).toBe(true);
    const form = { ...emptyParserForm(), ...definitionToFormFields(definition) };
    expect(buildParserDefinition(form)).toEqual(definition);
  });

  it('carries the source into a parser form', () => {
    const parser = { definition: { version: 2, source: 'html' }, name: 'x', payeeId: null, fromDomains: [], subjectContains: [] } as unknown as EmailReceiptParser;
    expect(parserToForm(parser).source).toBe('html');
  });
});
