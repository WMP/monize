'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useRuleWords } from '@/components/rules/RuleInWords';
import { RuleCardShell } from '@/components/rules/RuleCardShell';
import { RuleTemplateInput } from '@/components/rules/RuleTemplateInput';
import type { RuleOptions } from '@/components/rules/use-rule-options';
import { Combobox } from '@/components/ui/Combobox';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { RowAction } from '@/components/ui/row-actions/rowAction';
import {
  DESCRIPTION_MODES,
  changeActionType,
  isDescriptionMode,
  isEditableActionType,
  type EditableActionType,
  type EditorAction,
} from '@/lib/rule-actions';
import { checkTemplate } from '@/lib/rule-captures';
import {
  MAX_RULE_AI_INSTRUCTION_LENGTH,
  MAX_RULE_DESCRIPTION_TEMPLATE_LENGTH,
  MAX_RULE_PAYEE_TEMPLATE_LENGTH,
} from '@/lib/rule-fields';
import { cn, inputBaseClasses } from '@/lib/utils';

interface RuleActionCardProps {
  action: EditorAction;
  /** The types this card may be set to (`availableActionTypes`). */
  types: readonly EditableActionType[];
  options: RuleOptions;
  actions: RowAction[];
  errors: readonly string[];
  onChange: (action: EditorAction) => void;
  /** The capture names the rule's patterns define; the text actions offer them as placeholders. */
  captures?: readonly string[];
}

/** A switch with its name and a tooltip that explains it. */
function SwitchRow({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <InfoTooltip text={help} placement="top" usePortal />
    </div>
  );
}

/** The "Only if empty" switch of the actions that fill a field, with its explanation. */
function OnlyIfEmpty({
  checked,
  onChange,
  help,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The explanation; the default one is about the category and the payee. */
  help?: string;
}) {
  const t = useTranslations('rules.editor.action');
  return <SwitchRow checked={checked} onChange={onChange} label={t('onlyIfEmpty')} help={help ?? t('onlyIfEmptyHelp')} />;
}

/**
 * The codes of a text action's own inline message (`RuleTemplateInput`), so the
 * card's error list does not say the same thing twice.
 */
function inlineCodes(action: EditorAction, captures: readonly string[]): string[] {
  if (action.type !== 'set_payee_from_text' && action.type !== 'set_description') return [];
  const { malformed, unknown } = checkTemplate(action.template, captures);
  return [...(malformed.length > 0 ? ['INVALID_CAPTURE'] : []), ...(unknown.length > 0 ? ['UNKNOWN_CAPTURE'] : [])];
}

function ActionParameters({
  action,
  options,
  onChange,
  captures,
}: Pick<RuleActionCardProps, 'action' | 'options' | 'onChange'> & { captures: readonly string[] }) {
  const t = useTranslations('rules.editor');

  switch (action.type) {
    case 'add_tags':
    case 'remove_tags':
      return (
        <MultiSelect
          label={t('action.tags')}
          options={options.tags}
          value={[...action.tagIds]}
          onChange={(tagIds) => onChange({ ...action, tagIds })}
          placeholder={t('value.tags')}
        />
      );
    case 'set_category':
      return (
        <div>
          <Combobox
            label={t('action.category')}
            placeholder={t('value.category')}
            options={options.categories}
            value={action.categoryId}
            onChange={(categoryId) => onChange({ ...action, categoryId })}
            valueIsId
            usePortal
          />
          <OnlyIfEmpty checked={action.onlyIfEmpty} onChange={(onlyIfEmpty) => onChange({ ...action, onlyIfEmpty })} />
        </div>
      );
    case 'set_payee':
      return (
        <div>
          <Combobox
            label={t('action.payee')}
            placeholder={t('value.payee')}
            options={options.payees}
            value={action.payeeId}
            onChange={(payeeId) => onChange({ ...action, payeeId })}
            valueIsId
            usePortal
          />
          <OnlyIfEmpty checked={action.onlyIfEmpty} onChange={(onlyIfEmpty) => onChange({ ...action, onlyIfEmpty })} />
        </div>
      );
    case 'set_payee_from_text':
      return (
        <div className="space-y-2">
          <RuleTemplateInput
            id={`${action.uid}-template`}
            label={t('action.payeeTemplate')}
            value={action.template}
            maxLength={MAX_RULE_PAYEE_TEMPLATE_LENGTH}
            captures={captures}
            help={t('action.templateHelp')}
            onChange={(template) => onChange({ ...action, template })}
          />
          <div>
            <SwitchRow
              checked={action.createIfMissing}
              onChange={(createIfMissing) => onChange({ ...action, createIfMissing })}
              label={t('action.createIfMissing')}
              help={t('action.createIfMissingHelp')}
            />
            <OnlyIfEmpty checked={action.onlyIfEmpty} onChange={(onlyIfEmpty) => onChange({ ...action, onlyIfEmpty })} />
          </div>
        </div>
      );
    case 'set_description':
      return (
        <div className="space-y-2">
          <Select
            id={`${action.uid}-mode`}
            label={t('action.mode')}
            value={action.mode}
            options={DESCRIPTION_MODES.map((mode) => ({ value: mode, label: t(`action.modes.${mode}`) }))}
            onChange={(e) => {
              if (isDescriptionMode(e.target.value)) onChange({ ...action, mode: e.target.value });
            }}
          />
          <RuleTemplateInput
            id={`${action.uid}-template`}
            label={t('action.descriptionTemplate')}
            value={action.template}
            maxLength={MAX_RULE_DESCRIPTION_TEMPLATE_LENGTH}
            captures={captures}
            help={t('action.templateHelp')}
            note={action.mode === 'replace' ? undefined : t('action.joinHelp')}
            onChange={(template) => onChange({ ...action, template })}
          />
          <OnlyIfEmpty
            checked={action.onlyIfEmpty}
            onChange={(onlyIfEmpty) => onChange({ ...action, onlyIfEmpty })}
            help={t('action.onlyIfEmptyDescriptionHelp')}
          />
        </div>
      );
    case 'request_ai_review':
      return (
        <div>
          <label htmlFor={`${action.uid}-instruction`} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('action.instruction')}
          </label>
          <textarea
            id={`${action.uid}-instruction`}
            rows={2}
            maxLength={MAX_RULE_AI_INSTRUCTION_LENGTH}
            value={action.instruction}
            placeholder={t('action.instructionPlaceholder')}
            onChange={(e) => onChange({ ...action, instruction: e.target.value })}
            className={cn(inputBaseClasses, 'border px-3 py-2 font-sans focus-visible:ring-1 focus-visible:outline-none')}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('action.instructionHelp')}</p>
          <Link href="/ai-reviews" className="mt-1 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400">
            {t('action.reviewInbox')}
          </Link>
        </div>
      );
  }
}

/** An option list as the id-to-name table the sentences read. */
const namesOf = (options: readonly { value: string; label: string }[]): Record<string, string> =>
  Object.fromEntries(options.map((option) => [option.value, option.label]));

/**
 * A transfer or a split: made through the assistant or MCP, shown here as a
 * sentence and kept as stored. It can be moved or removed with the card's menu.
 */
function StructuralActionBody({
  action,
  options,
}: {
  action: Extract<EditorAction, { stored: unknown }>;
  options: RuleOptions;
}) {
  const t = useTranslations('rules.editor');
  const labels = useMemo(
    () => ({
      accounts: namesOf(options.accounts),
      payees: namesOf(options.payees),
      categories: namesOf(options.categories),
      tags: namesOf(options.tags),
    }),
    [options],
  );
  const { actionText } = useRuleWords(labels);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t(`actionTypes.${action.type}`)}</p>
      <p className="text-sm text-gray-700 dark:text-gray-300">{actionText(action.stored)}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('action.structuralReadOnly')}</p>
    </div>
  );
}

/**
 * One action: its type, and the parameters that type takes. Changing the type
 * starts the parameters over (the card keeps its place). The type list leaves
 * out `request_ai_review` when another card already holds it, because the
 * server allows one per rule.
 */
export function RuleActionCard({ action, types, options, actions, errors, onChange, captures = [] }: RuleActionCardProps) {
  const t = useTranslations('rules.editor');
  const shownInline = inlineCodes(action, captures);

  if (action.type === 'convert_to_transfer' || action.type === 'split') {
    return (
      <RuleCardShell label={t('action.title')} actions={actions} errors={errors}>
        <StructuralActionBody action={action} options={options} />
      </RuleCardShell>
    );
  }

  return (
    <RuleCardShell label={t('action.title')} actions={actions} errors={errors.filter((code) => !shownInline.includes(code))}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Select
          id={`${action.uid}-type`}
          label={t('action.type')}
          value={action.type}
          options={types.map((type) => ({ value: type, label: t(`actionTypes.${type}`) }))}
          onChange={(e) => {
            if (isEditableActionType(e.target.value)) onChange(changeActionType(action, e.target.value));
          }}
        />
        <ActionParameters action={action} options={options} onChange={onChange} captures={captures} />
      </div>
    </RuleCardShell>
  );
}
