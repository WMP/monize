'use client';

import { useTranslations } from 'next-intl';
import { RECEIPT_PARSER_LIMITS, type ReceiptParserValidationError } from '@/types/email-receipts';

const PATTERN_FIELDS = ['orderId', 'total', 'paid', 'shipping', 'discount', 'payee'] as const;
const GUARD_FIELDS = ['requireLine', 'skipIfLine', 'waitIfLine'] as const;
type PatternField = (typeof PATTERN_FIELDS)[number];

const isPatternField = (name: string): name is PatternField => (PATTERN_FIELDS as readonly string[]).includes(name);
const isGuardField = (name: string): name is (typeof GUARD_FIELDS)[number] =>
  (GUARD_FIELDS as readonly string[]).includes(name);

type Translator = ReturnType<typeof useTranslations>;

/**
 * Where a problem is, in the words of the form rather than the JSON: the
 * server reports `items.patterns[1]`, the person sees "Item patterns, line 2".
 * A path this client does not know is shown as it is, never dropped.
 */
export function describeProblemPath(path: string, t: Translator): string {
  if (path === '' || path === 'version') return t('paths.definition');

  const guard = /^(\w+)(?:\[(\d+)\])?$/.exec(path);
  if (guard && isGuardField(guard[1])) {
    return guard[2] === undefined
      ? t(`fields.${guard[1]}`)
      : t('paths.line', { field: t(`fields.${guard[1]}`), line: Number(guard[2]) + 1 });
  }

  const entryPart = /^(\w+)\[(\d+)\]\.(label|value|within)$/.exec(path);
  if (entryPart && isPatternField(entryPart[1])) {
    return t('paths.entryPart', {
      field: t(`fields.${entryPart[1]}`),
      line: Number(entryPart[2]) + 1,
      part: t(`fields.${entryPart[3]}`),
    });
  }

  const pattern = /^(\w+)\[(\d+)\]$/.exec(path);
  if (pattern && isPatternField(pattern[1])) {
    return t('paths.line', { field: t(`fields.${pattern[1]}`), line: Number(pattern[2]) + 1 });
  }
  if (isPatternField(path)) return t(`fields.${path}`);

  const item = /^items\.patterns\[(\d+)\]$/.exec(path);
  if (item) return t('paths.line', { field: t('fields.itemPatterns'), line: Number(item[1]) + 1 });
  if (path === 'items.patterns') return t('fields.itemPatterns');
  const skip = /^items\.skipLines\[(\d+)\]$/.exec(path);
  if (skip) return t('paths.skipLine', { line: Number(skip[1]) + 1 });
  if (path === 'items.skipLines') return t('fields.skipLines');
  const alternative = /^items\.record\[(\d+)\]\.line\[(\d+)\]$/.exec(path);
  if (alternative) {
    return t('paths.recordAlternative', { step: Number(alternative[1]) + 1, alternative: Number(alternative[2]) + 1 });
  }
  const step = /^items\.record\[(\d+)\](?:\.(line|optional))?$/.exec(path);
  if (step) {
    return step[2]
      ? t('paths.recordStepPart', { step: Number(step[1]) + 1, part: t(`fields.${step[2]}`) })
      : t('paths.recordStep', { step: Number(step[1]) + 1 });
  }
  if (path === 'items.single') return t('fields.single');
  if (path === 'items.single.name') return t('fields.singleName');
  if (path === 'items.joinWrapped') return t('fields.joinWrapped');
  if (path === 'items.record') return t('fields.record');
  if (path === 'items.startAfter') return t('fields.startAfter');
  if (path === 'items.stopAt') return t('fields.stopAt');
  if (path === 'items') return t('fields.items');

  const rule = /^categoryRules\[(\d+)\]\.(match|categoryId|field)$/.exec(path);
  if (rule) {
    const part = rule[2] === 'match' ? 'fields.rulePattern' : rule[2] === 'field' ? 'fields.ruleField' : 'fields.ruleCategory';
    return t('paths.rule', { rule: Number(rule[1]) + 1, part: t(part) });
  }
  if (path === 'source') return t('fields.source');
  if (path === 'categoryRules') return t('fields.categoryRules');
  if (path === 'defaultCategoryId') return t('fields.defaultCategory');
  if (path === 'shippingCategoryId') return t('fields.shippingCategory');
  return path;
}

/** The bound a `too_many` or `too_long` code refers to at this path. */
function boundFor(code: string, path: string): number {
  if (code === 'too_many') {
    if (path.startsWith('categoryRules')) return RECEIPT_PARSER_LIMITS.maxCategoryRules;
    if (isGuardField(path)) return RECEIPT_PARSER_LIMITS.maxLineGuards;
    if (/^items\.record\[\d+\]\.line$/.test(path)) return RECEIPT_PARSER_LIMITS.maxStepAlternatives;
    if (path === 'items.skipLines') return RECEIPT_PARSER_LIMITS.maxSkipLines;
    if (path === 'items.record') return RECEIPT_PARSER_LIMITS.maxRecordSteps;
    return RECEIPT_PARSER_LIMITS.maxPatternsPerField;
  }
  if (code === 'out_of_range') return RECEIPT_PARSER_LIMITS.maxLabelWithin;
  return path.endsWith('startAfter') || path.endsWith('stopAt')
    ? RECEIPT_PARSER_LIMITS.maxSectionMarkerLength
    : RECEIPT_PARSER_LIMITS.maxPatternLength;
}

const KNOWN_CODES = new Set([
  'not_object',
  'unknown_key',
  'unsupported_version',
  'invalid_type',
  'empty',
  'too_many',
  'too_long',
  'control_character',
  'malformed_capture',
  'too_many_captures',
  'duplicate_capture',
  'capture_not_allowed',
  'capture_missing',
  'capture_conflict',
  'invalid_uuid',
  'out_of_range',
  'items_patterns_and_record',
  'items_shape_missing',
  'skip_lines_need_record',
  'record_name_missing',
  'items_single_conflict',
  'join_wrapped_needs_patterns',
  'invalid_value',
]);

interface ParserProblemsProps {
  /** The problems the server's validator listed. */
  problems: readonly ReceiptParserValidationError[];
}

/**
 * The validator's `path: code` problems as a list a person can act on, each
 * with where it is and what is wrong. The codes come from the server's closed
 * list; one this client has not heard of falls back to the raw code rather than
 * hiding that something was refused.
 */
export function ParserProblems({ problems }: ParserProblemsProps) {
  const t = useTranslations('emailReceipts.problems');

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
      <p className="text-sm font-semibold text-red-800 dark:text-red-200">{t('heading')}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
        {problems.map((problem, index) => (
          <li key={`${problem.path}-${problem.code}-${index}`}>
            {t('item', {
              where: describeProblemPath(problem.path, t),
              problem: KNOWN_CODES.has(problem.code)
                ? t(`codes.${problem.code}`, {
                    max: boundFor(problem.code, problem.path),
                    capture: '{name}',
                  })
                : problem.code,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
