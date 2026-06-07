'use client';

import { useTranslations } from 'next-intl';
import type { BudgetStrategy } from '@/types/budget';

interface StrategyDetailKeys {
  titleKey: string;
  descriptionKey: string;
  proKeys: string[];
  conKeys: string[];
  bestForKey: string;
}

const STRATEGY_DETAILS: Record<BudgetStrategy, StrategyDetailKeys> = {
  FIXED: {
    titleKey: 'strategyDetail.fixedTitle',
    descriptionKey: 'strategyDetail.fixedDescription',
    proKeys: [
      'strategyDetail.fixedPro1',
      'strategyDetail.fixedPro2',
      'strategyDetail.fixedPro3',
      'strategyDetail.fixedPro4',
    ],
    conKeys: [
      'strategyDetail.fixedCon1',
      'strategyDetail.fixedCon2',
      'strategyDetail.fixedCon3',
      'strategyDetail.fixedCon4',
    ],
    bestForKey: 'strategyDetail.fixedBestFor',
  },
  ROLLOVER: {
    titleKey: 'strategyDetail.rolloverTitle',
    descriptionKey: 'strategyDetail.rolloverDescription',
    proKeys: [
      'strategyDetail.rolloverPro1',
      'strategyDetail.rolloverPro2',
      'strategyDetail.rolloverPro3',
      'strategyDetail.rolloverPro4',
    ],
    conKeys: [
      'strategyDetail.rolloverCon1',
      'strategyDetail.rolloverCon2',
      'strategyDetail.rolloverCon3',
      'strategyDetail.rolloverCon4',
    ],
    bestForKey: 'strategyDetail.rolloverBestFor',
  },
  ZERO_BASED: {
    titleKey: 'strategyDetail.zeroBasedTitle',
    descriptionKey: 'strategyDetail.zeroBasedDescription',
    proKeys: [
      'strategyDetail.zeroBasedPro1',
      'strategyDetail.zeroBasedPro2',
      'strategyDetail.zeroBasedPro3',
      'strategyDetail.zeroBasedPro4',
    ],
    conKeys: [
      'strategyDetail.zeroBasedCon1',
      'strategyDetail.zeroBasedCon2',
      'strategyDetail.zeroBasedCon3',
      'strategyDetail.zeroBasedCon4',
    ],
    bestForKey: 'strategyDetail.zeroBasedBestFor',
  },
  FIFTY_THIRTY_TWENTY: {
    titleKey: 'strategyDetail.fiftyThirtyTwentyTitle',
    descriptionKey: 'strategyDetail.fiftyThirtyTwentyDescription',
    proKeys: [
      'strategyDetail.fiftyThirtyTwentyPro1',
      'strategyDetail.fiftyThirtyTwentyPro2',
      'strategyDetail.fiftyThirtyTwentyPro3',
      'strategyDetail.fiftyThirtyTwentyPro4',
    ],
    conKeys: [
      'strategyDetail.fiftyThirtyTwentyCon1',
      'strategyDetail.fiftyThirtyTwentyCon2',
      'strategyDetail.fiftyThirtyTwentyCon3',
      'strategyDetail.fiftyThirtyTwentyCon4',
    ],
    bestForKey: 'strategyDetail.fiftyThirtyTwentyBestFor',
  },
};

interface StrategyDetailCardProps {
  strategy: BudgetStrategy;
}

export function StrategyDetailCard({ strategy }: StrategyDetailCardProps) {
  const t = useTranslations('budgets');
  const detail = STRATEGY_DETAILS[strategy];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t(detail.titleKey)}
      </h4>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 min-h-[4.5rem]">
        {t(detail.descriptionKey)}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h5 className="text-sm font-medium text-green-700 dark:text-green-400">
            {t('strategyDetail.pros')}
          </h5>
          <ul className="mt-2 space-y-1.5">
            {detail.proKeys.map((proKey) => (
              <li
                key={proKey}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <span className="mt-0.5 text-green-500 dark:text-green-400">
                  +
                </span>
                {t(proKey)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h5 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('strategyDetail.cons')}
          </h5>
          <ul className="mt-2 space-y-1.5">
            {detail.conKeys.map((conKey) => (
              <li
                key={conKey}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <span className="mt-0.5 text-amber-500 dark:text-amber-400">
                  -
                </span>
                {t(conKey)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 rounded-md bg-blue-50 p-3 dark:bg-blue-900/20">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          <span className="font-medium">{t('strategyDetail.bestFor')}</span>
          {t(detail.bestForKey)}
        </p>
      </div>
    </div>
  );
}
