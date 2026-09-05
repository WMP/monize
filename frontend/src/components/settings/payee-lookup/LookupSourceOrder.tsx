'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/Select';
import { DropIndicatorLine, useDragReorder } from '@/hooks/useDragReorder';
import type {
  PayeeLookupPreferredSource,
  PayeeLookupSettings,
} from '@/types/payee-lookup';
import type { AiProviderConfig } from '@/types/ai';

/** The two sources, in the order they are asked. */
type SourceRow = PayeeLookupPreferredSource;

/**
 * How a provider is named in the picker.
 *
 * The model matters as much as the vendor -- two Anthropic rows differing only
 * by model are otherwise indistinguishable -- and `displayName` is the name the
 * user gave it, so it wins where they set one.
 */
function providerLabel(provider: AiProviderConfig): string {
  const name = provider.displayName || provider.provider;
  return provider.model ? `${name} (${provider.model})` : name;
}

interface LookupSourceOrderProps {
  settings: PayeeLookupSettings;
  /** The user's active AI providers, for the "which model" selector. */
  aiProviders: AiProviderConfig[];
  disabled?: boolean;
  onReorder: (first: PayeeLookupPreferredSource) => void;
  onSelectAiProvider: (configId: string | null) => void;
}

/**
 * The order the two lookup sources are asked in, reorderable by dragging a row
 * or by the up/down buttons on it.
 *
 * **Two items, so the order is one fact**: which one is first. It is stored as
 * `preferredSource` rather than as a list, because a stored array of two would
 * have states the domain does not (empty, duplicated, naming a source that no
 * longer exists) and every reader would have to defend against them.
 *
 * Drag comes from `useDragReorder`, the same hook the Favourite Accounts widget
 * and the dashboard customize dialog use, so a list reorders the same way
 * everywhere. The up/down buttons are not a lesser alternative to it: dragging
 * is unavailable to a keyboard and unreliable on a touch screen, and
 * `FavouriteAccounts` offers both for that reason.
 */
export function LookupSourceOrder({
  settings,
  aiProviders,
  disabled = false,
  onReorder,
  onSelectAiProvider,
}: LookupSourceOrderProps) {
  const t = useTranslations('settings.payeeLookup.order');
  const order: SourceRow[] =
    settings.preferredSource === 'ai'
      ? ['ai', 'google-places']
      : ['google-places', 'ai'];

  /**
   * Every legal move in a two-item list is the same move: the second becomes
   * the first. Written once so the drag path and the buttons cannot disagree
   * about what a reorder means -- and so neither has to reason about indices
   * that only ever have one outcome.
   */
  const swap = () => {
    if (disabled) return;
    onReorder(order[1]);
  };

  const moveItem = (from: number, to: number) => {
    if (from !== to) swap();
  };

  const move = (index: number, direction: -1 | 1) => {
    const to = index + direction;
    if (to < 0 || to >= order.length) return;
    swap();
  };

  const { dragIndex, rowProps, dropIndicator } = useDragReorder(moveItem);

  return (
    <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {t('title')}
      </p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t('subtitle')}
      </p>

      <ol className="mt-3 space-y-2">
        {order.map((source, index) => (
          <li
            key={source}
            {...(disabled ? {} : rowProps(index))}
            className={`relative flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 ${
              disabled ? '' : 'cursor-grab'
            } ${dragIndex === index ? 'opacity-50' : ''}`}
          >
            <DropIndicatorLine position={dropIndicator(index, order.length)} />

            <span
              aria-hidden="true"
              className="mt-0.5 w-4 shrink-0 text-sm font-semibold text-gray-400 dark:text-gray-500"
            >
              {index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t(source === 'ai' ? 'aiTitle' : 'placesTitle')}
              </p>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {t(source === 'ai' ? 'aiHelp' : 'placesHelp')}
              </p>

              {/* Which model answers, offered only where there is a choice to
                  make: with one provider the select would be a control with a
                  single option, and with none it would name nothing. */}
              {source === 'ai' && aiProviders.length > 1 && (
                <div className="mt-2">
                  <Select
                    label={t('aiProviderLabel')}
                    value={settings.aiProviderConfigId ?? ''}
                    disabled={disabled}
                    onChange={(e) => onSelectAiProvider(e.target.value || null)}
                    options={[
                      { value: '', label: t('aiProviderAny') },
                      ...aiProviders.map((provider) => ({
                        value: provider.id,
                        label: providerLabel(provider),
                      })),
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label={t('moveUp')}
                title={t('moveUp')}
                className="rounded p-1 text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none dark:hover:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={disabled || index === order.length - 1}
                aria-label={t('moveDown')}
                title={t('moveDown')}
                className="rounded p-1 text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none dark:hover:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
