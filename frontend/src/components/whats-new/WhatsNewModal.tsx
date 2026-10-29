'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ReleaseNotesMarkdown } from './ReleaseNotesMarkdown';
import { TourOfferList } from './TourOfferList';
import type { ReleaseNotes } from '@/lib/whats-new';

interface WhatsNewModalProps {
  isOpen: boolean;
  notes: ReleaseNotes | null;
  loading?: boolean;
  /** Whether the viewer is signed in — gates the "seen" actions. */
  authenticated: boolean;
  /** Running app version; drives the guided-tour offer list (authenticated only). */
  currentVersion?: string;
  /** Close without changing state (Close, backdrop, Escape). */
  onClose: () => void;
  /**
   * Called when a tour starts from the offer list, so the host can step the
   * modal aside (and bring it back afterwards) rather than plainly close it.
   * Falls back to `onClose`.
   */
  onTourStart?: () => void;
  /**
   * Clear the acknowledgement so the digest shows again next login ("Show at
   * next login"). Only when authenticated; falls back to a plain close.
   */
  onShowNextLogin?: () => void;
  /** Acknowledge the version ("Don't show this again"). Only when authenticated. */
  onDontShowAgain?: () => void;
}

const sectionKey = (i: number) => `s${i}`;
const childKey = (i: number, j: number) => `s${i}.c${j}`;

/** All accordion keys, plus the subset expanded by default (top-level sections). */
function collectKeys(notes: ReleaseNotes | null): {
  all: string[];
  defaults: string[];
} {
  if (!notes) return { all: [], defaults: [] };
  const all: string[] = [];
  const defaults: string[] = [];
  notes.sections.forEach((section, i) => {
    const sk = sectionKey(i);
    all.push(sk);
    defaults.push(sk);
    section.children.forEach((_, j) => all.push(childKey(i, j)));
  });
  return { all, defaults };
}

export function WhatsNewModal({
  isOpen,
  notes,
  loading = false,
  authenticated,
  currentVersion,
  onClose,
  onTourStart,
  onShowNextLogin,
  onDontShowAgain,
}: WhatsNewModalProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  // The notes are curated Markdown shipped in the image and written in English
  // only, while everything around them is translated. Say so, rather than
  // leaving a reader of another language wondering what went wrong.
  const notesAreForeign = !locale.toLowerCase().startsWith('en');

  const { all: allKeys, defaults } = useMemo(() => collectKeys(notes), [notes]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaults),
  );

  // Reset the accordion to its default (sections open, details collapsed)
  // whenever the notes change, using the "info from previous render" pattern so
  // we avoid setState-in-effect.
  const [trackedVersion, setTrackedVersion] = useState(notes?.version);
  if (notes?.version !== trackedVersion) {
    setTrackedVersion(notes?.version);
    setExpanded(new Set(defaults));
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const allExpanded =
    allKeys.length > 0 && allKeys.every((k) => expanded.has(k));

  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(allKeys));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="4xl"
      pushHistory
      title={t('whatsNew.title')}
      padding="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {notes ? (
            <a
              href={notes.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('whatsNew.viewFullNotes')}
            </a>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {/* Close leaves the acknowledgement as it was; the two choices
                beside it change it. */}
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('whatsNew.close')}
            </Button>
            {authenticated && onDontShowAgain && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onShowNextLogin ?? onClose}
                >
                  {t('whatsNew.showNextLogin')}
                </Button>
                <Button variant="primary" size="sm" onClick={onDontShowAgain}>
                  {t('whatsNew.dontShowAgain')}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div>
        {notes && (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t('whatsNew.versionLabel', { version: notes.version })}
          </p>
        )}
        {authenticated && currentVersion && (
          <TourOfferList
            currentVersion={currentVersion}
            onStartTour={onTourStart ?? onClose}
          />
        )}
        {notes ? (
          <>
            {notesAreForeign && (
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {t('whatsNew.englishOnly')}
              </p>
            )}
            {notes.intro && (
              <div className="mb-4">
                <ReleaseNotesMarkdown content={notes.intro} />
              </div>
            )}

            {notes.sections.length > 0 && (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus-visible:underline"
                >
                  {allExpanded
                    ? t('whatsNew.collapseAll')
                    : t('whatsNew.expandAll')}
                </button>
              </div>
            )}

            <div className="divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
              {notes.sections.map((section, i) => {
                const key = sectionKey(i);
                const open = expanded.has(key);
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                    >
                      <ChevronRightIcon
                        className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${
                          open ? 'rotate-90' : ''
                        }`}
                      />
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {section.heading}
                      </span>
                    </button>

                    {open && (
                      <div className="pb-3 pl-7">
                        {section.body && (
                          <div className="mb-2">
                            <ReleaseNotesMarkdown content={section.body} />
                          </div>
                        )}

                        {section.children.length > 0 && (
                          <div className="space-y-1">
                            {section.children.map((child, j) => {
                              const ckey = childKey(i, j);
                              const childOpen = expanded.has(ckey);
                              return (
                                <div
                                  key={ckey}
                                  className="rounded border border-gray-100 dark:border-gray-700/60"
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggle(ckey)}
                                    aria-expanded={childOpen}
                                    className="flex w-full items-center gap-2 px-2 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                                  >
                                    <ChevronRightIcon
                                      className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                                        childOpen ? 'rotate-90' : ''
                                      }`}
                                    />
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                      {child.heading}
                                    </span>
                                  </button>
                                  {childOpen && (
                                    <div className="px-3 pb-3 pl-8">
                                      <ReleaseNotesMarkdown
                                        content={child.body}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : loading ? (
          <div className="py-8">
            <LoadingSpinner />
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400 py-4">
            {t('whatsNew.unavailable')}
          </p>
        )}
      </div>
    </Modal>
  );
}
