'use client';

import { MutableRefObject, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import {
  delegationApi,
  DelegateSummary,
  AccountGrant,
  DelegateCapabilities,
  DelegateSectionFlags,
} from '@/lib/delegation';
import { Account, AccountType } from '@/types/account';
import { useAccountTypeLabel } from '@/hooks/useAccountTypeLabel';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';

const logger = createLogger('DelegateAccessModal');

type GrantOp = 'canRead' | 'canCreate' | 'canEdit' | 'canDelete';
type CapOp = 'create' | 'edit' | 'delete';
type CapResource = 'payees' | 'categories' | 'tags';
type SectionKey = 'bills' | 'investments' | 'budgets' | 'reports' | 'ai';
type Tab = 'sections' | 'accounts' | 'shared';

interface DraftGrant {
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface Draft {
  grants: Record<string, DraftGrant>;
  capabilities: Record<CapResource, Record<CapOp, boolean>>;
  sections: Record<SectionKey, boolean>;
}

const GRANT_OPS: { key: GrantOp; labelKey: string }[] = [
  { key: 'canRead', labelKey: 'delegateAccess.ops.read' },
  { key: 'canCreate', labelKey: 'delegateAccess.ops.create' },
  { key: 'canEdit', labelKey: 'delegateAccess.ops.edit' },
  { key: 'canDelete', labelKey: 'delegateAccess.ops.delete' },
];

const CAP_RESOURCES: { key: CapResource; labelKey: string }[] = [
  { key: 'payees', labelKey: 'delegateAccess.resources.payees' },
  { key: 'categories', labelKey: 'delegateAccess.resources.categories' },
  { key: 'tags', labelKey: 'delegateAccess.resources.tags' },
];

const CAP_OPS: { op: CapOp; labelKey: string }[] = [
  { op: 'create', labelKey: 'delegateAccess.ops.create' },
  { op: 'edit', labelKey: 'delegateAccess.ops.edit' },
  { op: 'delete', labelKey: 'delegateAccess.ops.delete' },
];

const SECTIONS: { key: SectionKey; labelKey: string; descriptionKey: string }[] = [
  {
    key: 'bills',
    labelKey: 'delegateAccess.sections.bills',
    descriptionKey: 'delegateAccess.sections.billsDescription',
  },
  {
    key: 'investments',
    labelKey: 'delegateAccess.sections.investments',
    descriptionKey: 'delegateAccess.sections.investmentsDescription',
  },
  { key: 'budgets', labelKey: 'delegateAccess.sections.budgets', descriptionKey: 'delegateAccess.sections.budgetsDescription' },
  { key: 'reports', labelKey: 'delegateAccess.sections.reports', descriptionKey: 'delegateAccess.sections.reportsDescription' },
  {
    key: 'ai',
    labelKey: 'delegateAccess.sections.ai',
    descriptionKey: 'delegateAccess.sections.aiDescription',
  },
];

const SECTION_FIELD: Record<SectionKey, keyof DelegateSectionFlags> = {
  bills: 'billsCanRead',
  investments: 'investmentsCanRead',
  budgets: 'budgetsCanRead',
  reports: 'reportsCanRead',
  ai: 'aiCanRead',
};

function emptyGrant(): DraftGrant {
  return { canRead: false, canCreate: false, canEdit: false, canDelete: false };
}

function buildInitialDraft(delegate: DelegateSummary): Draft {
  const grants: Record<string, DraftGrant> = {};
  for (const g of delegate.grants) {
    grants[g.accountId] = {
      canRead: !!g.canRead,
      canCreate: !!g.canCreate,
      canEdit: !!g.canEdit,
      canDelete: !!g.canDelete,
    };
  }
  const caps = delegate.capabilities;
  return {
    grants,
    capabilities: {
      payees: { ...caps.payees },
      categories: { ...caps.categories },
      tags: { ...caps.tags },
    },
    sections: {
      bills: !!delegate.sections?.bills,
      investments: !!delegate.sections?.investments,
      budgets: !!delegate.sections?.budgets,
      reports: !!delegate.sections?.reports,
      ai: !!delegate.sections?.ai,
    },
  };
}

/** Apply READ-prerequisite rules to a single grant change. */
function applyGrantRule(
  current: DraftGrant,
  op: GrantOp,
  value: boolean,
): DraftGrant {
  const next: DraftGrant = { ...current, [op]: value };
  if (op === 'canRead' && !value) {
    next.canCreate = false;
    next.canEdit = false;
    next.canDelete = false;
  }
  if (op !== 'canRead' && value) {
    next.canRead = true;
  }
  return next;
}

function grantsToArray(
  accounts: Account[],
  grants: Record<string, DraftGrant>,
): AccountGrant[] {
  return accounts
    .map((a) => ({ accountId: a.id, ...(grants[a.id] ?? emptyGrant()) }))
    .filter((g) => g.canRead);
}

interface DelegateAccessModalProps {
  delegate: DelegateSummary;
  accounts: Account[];
  onCancel: () => void;
  onSaved: () => void;
  setFormDirty: (dirty: boolean) => void;
  submitRef: MutableRefObject<(() => void) | null>;
}

export function DelegateAccessModal({
  delegate,
  accounts,
  onCancel,
  onSaved,
  setFormDirty,
  submitRef,
}: DelegateAccessModalProps) {
  const t = useTranslations('settings');
  const formatAccountType = useAccountTypeLabel();
  const baseline = useMemo(
    () => buildInitialDraft(delegate),
    [delegate],
  );
  const [draft, setDraft] = useState<Draft>(baseline);
  const [tab, setTab] = useState<Tab>('accounts');
  const [saving, setSaving] = useState(false);

  const groupedAccounts = useMemo(() => {
    const groups = new Map<AccountType, Account[]>();
    for (const a of accounts) {
      const list = groups.get(a.accountType) ?? [];
      list.push(a);
      groups.set(a.accountType, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(groups.entries()).sort((x, y) =>
      formatAccountType(x[0]).localeCompare(formatAccountType(y[0])),
    );
  }, [accounts, formatAccountType]);

  const baselineGrantArray = useMemo(
    () => grantsToArray(accounts, baseline.grants),
    [accounts, baseline],
  );

  // Diffs against the baseline drive both the dirty flag and the batched save.
  const grantChanged =
    JSON.stringify(grantsToArray(accounts, draft.grants)) !==
    JSON.stringify(baselineGrantArray);

  const capabilityPatch: DelegateCapabilities = {};
  for (const { key: resource } of CAP_RESOURCES) {
    for (const { op } of CAP_OPS) {
      if (
        draft.capabilities[resource][op] !==
        baseline.capabilities[resource][op]
      ) {
        const cap = op.charAt(0).toUpperCase() + op.slice(1);
        const field =
          `${resource}Can${cap}` as keyof DelegateCapabilities;
        capabilityPatch[field] = draft.capabilities[resource][op];
      }
    }
  }

  const sectionPatch: DelegateSectionFlags = {};
  for (const { key } of SECTIONS) {
    if (draft.sections[key] !== baseline.sections[key]) {
      sectionPatch[SECTION_FIELD[key]] = draft.sections[key];
    }
  }

  const dirty =
    grantChanged ||
    Object.keys(capabilityPatch).length > 0 ||
    Object.keys(sectionPatch).length > 0;
  setFormDirty(dirty);

  const setGrant = (accountId: string, op: GrantOp, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      grants: {
        ...prev.grants,
        [accountId]: applyGrantRule(
          prev.grants[accountId] ?? emptyGrant(),
          op,
          value,
        ),
      },
    }));
  };

  const setColumnForAccounts = (
    accountIds: string[],
    op: GrantOp,
    value: boolean,
  ) => {
    setDraft((prev) => {
      const grants = { ...prev.grants };
      for (const id of accountIds) {
        grants[id] = applyGrantRule(grants[id] ?? emptyGrant(), op, value);
      }
      return { ...prev, grants };
    });
  };

  const setCapability = (
    resource: CapResource,
    op: CapOp,
    value: boolean,
  ) => {
    setDraft((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [resource]: { ...prev.capabilities[resource], [op]: value },
      },
    }));
  };

  const setSection = (key: SectionKey, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      sections: { ...prev.sections, [key]: value },
    }));
  };

  const handleSave = async () => {
    if (!dirty) {
      onSaved();
      return;
    }
    setSaving(true);
    try {
      const calls: Promise<void>[] = [];
      if (grantChanged) {
        calls.push(
          delegationApi.setGrants(
            delegate.id,
            grantsToArray(accounts, draft.grants),
          ),
        );
      }
      if (Object.keys(capabilityPatch).length > 0) {
        calls.push(
          delegationApi.setCapabilities(delegate.id, capabilityPatch),
        );
      }
      if (Object.keys(sectionPatch).length > 0) {
        calls.push(
          delegationApi.setSectionGrants(delegate.id, sectionPatch),
        );
      }
      await Promise.all(calls);
      toast.success(t('delegateAccess.accessUpdated'));
      setFormDirty(false);
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, t('delegateAccess.updateError')));
      logger.error(err);
    } finally {
      setSaving(false);
    }
  };

  submitRef.current = () => {
    void handleSave();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'accounts', label: t('delegateAccess.tabAccounts') },
    { key: 'sections', label: t('delegateAccess.tabSections') },
    { key: 'shared', label: t('delegateAccess.tabShared') },
  ];

  return (
    <div className="flex flex-col max-h-[90vh]">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('delegateAccess.editAccess')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {delegate.delegate.email}
        </p>
      </div>

      <div
        role="tablist"
        className="flex gap-1 border-b border-gray-200 dark:border-gray-700 px-2"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto px-4 py-3 h-[65vh]">
        {tab === 'sections' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('delegateAccess.sectionsHint')}
            </p>
            {SECTIONS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700/50 pb-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t(s.labelKey)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t(s.descriptionKey)}
                  </p>
                </div>
                <ToggleSwitch
                  checked={draft.sections[s.key]}
                  onChange={(v) => setSection(s.key, v)}
                  label={t('delegateAccess.aria.sectionToggle', { label: t(s.labelKey) })}
                />
              </div>
            ))}
          </div>
        )}

        {tab === 'accounts' && (
          <div className="space-y-3">
            {accounts.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('delegateAccess.noAccountsToGrant')}
              </p>
            ) : (
              groupedAccounts.map(([type, list]) => {
                const typeLabel = formatAccountType(type);
                const ids = list.map((a) => a.id);
                return (
                  <details
                    key={type}
                    open
                    className="border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                      {typeLabel}{' '}
                      <span className="text-xs text-gray-400">
                        ({list.length})
                      </span>
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 dark:border-gray-700/50 pb-2 mb-2">
                        <span className="w-40 text-xs uppercase tracking-wide text-gray-400">
                          {t('delegateAccess.grantAll')}
                        </span>
                        {GRANT_OPS.map((o) => (
                          <label
                            key={o.key}
                            className="flex items-center gap-1.5"
                          >
                            <ToggleSwitch
                              size="sm"
                              checked={list.every(
                                (a) =>
                                  !!(draft.grants[a.id] ?? emptyGrant())[
                                    o.key
                                  ],
                              )}
                              onChange={(v) =>
                                setColumnForAccounts(ids, o.key, v)
                              }
                              label={t('delegateAccess.aria.grantAllType', { op: t(o.labelKey), type: typeLabel })}
                            />
                            <span className="text-xs">{t(o.labelKey)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="space-y-2">
                        {list.map((a) => {
                          const g = draft.grants[a.id] ?? emptyGrant();
                          return (
                            <div
                              key={a.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300"
                            >
                              <span className="w-40 truncate font-medium">
                                {a.name}
                              </span>
                              {GRANT_OPS.map((o) => (
                                <label
                                  key={o.key}
                                  className="flex items-center gap-1.5"
                                >
                                  <ToggleSwitch
                                    size="sm"
                                    checked={!!g[o.key]}
                                    disabled={
                                      o.key !== 'canRead' && !g.canRead
                                    }
                                    onChange={(v) =>
                                      setGrant(a.id, o.key, v)
                                    }
                                    label={t('delegateAccess.aria.grantAccount', { op: t(o.labelKey), account: a.name })}
                                  />
                                  <span className="text-xs">{t(o.labelKey)}</span>
                                </label>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })
            )}
          </div>
        )}

        {tab === 'shared' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {t('delegateAccess.sharedHint')}
            </p>
            {CAP_RESOURCES.map((res) => (
              <div
                key={res.key}
                className="flex items-center gap-x-3 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700/50 pb-2"
              >
                <span className="w-24 shrink-0 truncate font-medium">
                  {t(res.labelKey)}
                </span>
                {CAP_OPS.map((o) => (
                  <label key={o.op} className="flex items-center gap-1.5">
                    <ToggleSwitch
                      size="sm"
                      checked={draft.capabilities[res.key][o.op]}
                      onChange={(v) => setCapability(res.key, o.op, v)}
                      label={t('delegateAccess.aria.capability', { op: t(o.labelKey), resource: t(res.labelKey) })}
                    />
                    <span className="text-xs">{t(o.labelKey)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleSave()}
          isLoading={saving}
          disabled={!dirty}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
