'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { budgetsApi } from '@/lib/budgets';
import { getErrorMessage } from '@/lib/errors';
import { StrategyDetailCard } from './StrategyDetailCard';
import type { WizardState } from './BudgetWizard';
import type { BudgetProfile, BudgetStrategy, GenerateBudgetResponse } from '@/types/budget';

interface BudgetWizardAnalysisProps {
  state: WizardState;
  updateState: (updates: Partial<WizardState>) => void;
  onAnalysisComplete: (result: GenerateBudgetResponse) => void;
  onNext: () => void;
  onCancel: () => void;
}

const STRATEGIES: Array<{
  value: BudgetStrategy;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'FIXED',
    labelKey: 'wizardAnalysis.strategyFixedLabel',
    descriptionKey: 'wizardAnalysis.strategyFixedDescription',
  },
  {
    value: 'ROLLOVER',
    labelKey: 'wizardAnalysis.strategyRolloverLabel',
    descriptionKey: 'wizardAnalysis.strategyRolloverDescription',
  },
  {
    value: 'ZERO_BASED',
    labelKey: 'wizardAnalysis.strategyZeroBasedLabel',
    descriptionKey: 'wizardAnalysis.strategyZeroBasedDescription',
  },
  {
    value: 'FIFTY_THIRTY_TWENTY',
    labelKey: 'wizardAnalysis.strategyFiftyThirtyTwentyLabel',
    descriptionKey: 'wizardAnalysis.strategyFiftyThirtyTwentyDescription',
  },
];

const PROFILES: Array<{
  value: BudgetProfile;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'COMFORTABLE',
    labelKey: 'wizardAnalysis.profileComfortableLabel',
    descriptionKey: 'wizardAnalysis.profileComfortableDescription',
  },
  {
    value: 'ON_TRACK',
    labelKey: 'wizardAnalysis.profileOnTrackLabel',
    descriptionKey: 'wizardAnalysis.profileOnTrackDescription',
  },
  {
    value: 'AGGRESSIVE',
    labelKey: 'wizardAnalysis.profileAggressiveLabel',
    descriptionKey: 'wizardAnalysis.profileAggressiveDescription',
  },
];

const ANALYSIS_PERIODS = [
  { value: 3, labelKey: 'wizardAnalysis.period3' },
  { value: 6, labelKey: 'wizardAnalysis.period6' },
  { value: 12, labelKey: 'wizardAnalysis.period12' },
] as const;

export function BudgetWizardAnalysis({
  state,
  updateState,
  onAnalysisComplete,
  onNext,
  onCancel,
}: BudgetWizardAnalysisProps) {
  const t = useTranslations('budgets');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const strategyRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleStrategyClick = (value: BudgetStrategy) => {
    // Toggle on mobile: tap again to deselect
    const newStrategy = state.strategy === value ? null : value;
    updateState({ strategy: newStrategy });
  };

  const handleAnalyze = async () => {
    if (!state.strategy) return;
    setIsAnalyzing(true);
    try {
      const result = await budgetsApi.generate({
        analysisMonths: state.analysisMonths,
        strategy: state.strategy ?? undefined,
        profile: state.profile,
      });
      onAnalysisComplete(result);
      onNext();
    } catch (error) {
      toast.error(getErrorMessage(error, t('wizardAnalysis.analyzeFailed')));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Strategy selection */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('wizardAnalysis.chooseStrategy')}
        </h3>
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Strategy list - left side */}
          <div className="lg:w-[560px] lg:shrink-0 space-y-3">
            {/* Mobile: single column with detail card below selected */}
            <div className="flex flex-col gap-3 lg:hidden">
              {STRATEGIES.map((s) => {
                const isSelected = state.strategy === s.value;
                return (
                  <div key={s.value}>
                    <button
                      ref={(el) => {
                        if (el) strategyRefs.current.set(s.value, el);
                      }}
                      type="button"
                      onClick={() => handleStrategyClick(s.value)}
                      data-testid={`strategy-${s.value}-mobile`}
                      className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {t(s.labelKey)}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t(s.descriptionKey)}
                      </div>
                    </button>
                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        isSelected ? 'max-h-[800px] opacity-100 mt-3' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <StrategyDetailCard strategy={s.value} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Desktop: 2-column grid */}
            <div className="hidden lg:grid grid-cols-2 gap-3">
              {STRATEGIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => updateState({ strategy: s.value })}
                  data-testid={`strategy-${s.value}`}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                    state.strategy === s.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {t(s.labelKey)}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {t(s.descriptionKey)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detail card - right side (desktop only) */}
          {state.strategy && (
            <div className="hidden lg:block lg:flex-1 lg:min-w-0">
              <div className="sticky top-4">
                <StrategyDetailCard strategy={state.strategy} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Analysis period */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('wizardAnalysis.analysisPeriod')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          {t('wizardAnalysis.analysisPeriodDescription')}
        </p>
        <div className="flex gap-3">
          {ANALYSIS_PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => updateState({ analysisMonths: p.value })}
              className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${
                state.analysisMonths === p.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Budget profile */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('wizardAnalysis.budgetProfile')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PROFILES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => updateState({ profile: p.value })}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                state.profile === p.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'
              }`}
            >
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {t(p.labelKey)}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t(p.descriptionKey)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Button variant="outline" onClick={onCancel}>
          {t('wizardAnalysis.cancel')}
        </Button>
        <Button onClick={handleAnalyze} isLoading={isAnalyzing} disabled={!state.strategy}>
          {t('wizardAnalysis.analyzeMySpending')}
        </Button>
      </div>
    </div>
  );
}
