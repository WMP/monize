'use client';

import { useTranslations } from 'next-intl';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';

interface StackTaggedFlowsToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/**
 * The opt-in switch that draws the tagged flows on top of the income and
 * expense bars instead of beside them (`docs/specs/report-tag-key-breakdown.md`
 * section 10.7). The caller renders it only while a tagged series exists, and
 * persists the choice; stacking is presentation, so no figure depends on it.
 */
export function StackTaggedFlowsToggle({ checked, onChange }: StackTaggedFlowsToggleProps) {
  const t = useTranslations('reports');
  const label = t('tagBreakdown.stackFlows');
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <ToggleSwitch checked={checked} onChange={onChange} label={label} size="sm" />
      <span>{label}</span>
    </div>
  );
}
