'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { getErrorMessage } from '@/lib/errors';
import { accountsApi } from '@/lib/accounts';
import { investmentsApi } from '@/lib/investments';
import { isInvestmentBrokerageAccount } from '@/lib/account-utils';
import type { Account } from '@/types/account';
import type { Security } from '@/types/investment';
import {
  brokerImportApi,
  type BrokerImportParsedOrder,
  type BrokerImportApplyOrder,
} from '@/lib/ai-broker-import';

// Combobox value sentinel for "create a brand-new security for this order".
const NEW_SECURITY = '__new__';

/** Editable, per-row review state layered on top of a parsed order. */
interface OrderRow {
  rowId: string;
  securityName: string;
  exchange: string | null;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  commission: string;
  currency: string;
  tradeDate: string;
  include: boolean;
  /** Existing security id, NEW_SECURITY for "create new", or '' when unset. */
  securityChoice: string;
  /** New-security inputs, revealed when securityChoice === NEW_SECURITY. */
  newSymbol: string;
  newName: string;
  newExchange: string;
  newCurrency: string;
}

function toRow(order: BrokerImportParsedOrder): OrderRow {
  return {
    rowId: order.rowId,
    securityName: order.securityName,
    exchange: order.exchange,
    side: order.side,
    quantity: String(order.quantity),
    price: String(order.price),
    commission: String(order.commission),
    currency: order.currency,
    tradeDate: order.tradeDate,
    include: true,
    securityChoice: order.matchedSecurityId ?? '',
    newSymbol: '',
    newName: order.securityName,
    newExchange: order.exchange ?? '',
    newCurrency: order.currency,
  };
}

export function BrokerImport() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [accountId, setAccountId] = useState('');

  // The captured clipboard payload (HTML when available, else plain text).
  const [capturedHtml, setCapturedHtml] = useState('');
  const [captureKind, setCaptureKind] = useState<'html' | 'text' | null>(null);

  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<OrderRow[]>([]);

  useEffect(() => {
    accountsApi
      .getAll()
      .then(setAccounts)
      .catch(() => {});
    investmentsApi
      .getSecurities()
      .then(setSecurities)
      .catch(() => {});
  }, []);

  // Only investment/brokerage accounts can hold investment transactions.
  const accountOptions = useMemo(() => {
    const eligible = accounts.filter(
      (a) =>
        a.accountType === 'INVESTMENT' || isInvestmentBrokerageAccount(a),
    );
    return [
      { value: '', label: 'Select an account', disabled: true },
      ...eligible.map((a) => ({
        value: a.id,
        label: `${a.name} (${a.currencyCode})${a.isClosed ? ' (Closed)' : ''}`,
      })),
    ];
  }, [accounts]);

  // Existing securities plus a "Create new security" option.
  const securityOptions = useMemo(
    () => [
      { value: NEW_SECURITY, label: 'Create new security...' },
      ...securities.map((s) => ({
        value: s.id,
        label: `${s.symbol} - ${s.name}`,
        keywords: [s.name, s.symbol],
      })),
    ],
    [securities],
  );

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const captured = html || text;
    setCapturedHtml(captured);
    setCaptureKind(html ? 'html' : text ? 'text' : null);
  };

  // Rough hint: count <tr> rows in HTML, else non-empty lines in plain text.
  const captureHint = useMemo(() => {
    if (!captureKind) return null;
    const size = capturedHtml.length;
    if (captureKind === 'html') {
      const rowCount = (capturedHtml.match(/<tr\b/gi) || []).length;
      return rowCount > 0
        ? `HTML table captured (~${rowCount} rows, ${size} chars)`
        : `HTML captured (${size} chars)`;
    }
    const lineCount = capturedHtml
      .split('\n')
      .filter((l) => l.trim().length > 0).length;
    return `Plain text captured (~${lineCount} lines, ${size} chars)`;
  }, [captureKind, capturedHtml]);

  const updateRow = (rowId: string, patch: Partial<OrderRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );
  };

  const runParse = async () => {
    if (!capturedHtml) return;
    setParsing(true);
    try {
      const data = await brokerImportApi.parse(capturedHtml);
      setWarnings(data.warnings);
      setRows(data.orders.map(toRow));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to parse the pasted history'));
    } finally {
      setParsing(false);
    }
  };

  const applySelected = async () => {
    if (!accountId) {
      toast.error('Choose a target account first');
      return;
    }
    const selected = rows.filter((r) => r.include);
    if (selected.length === 0) {
      toast.error('Select at least one order to add');
      return;
    }

    const orders: BrokerImportApplyOrder[] = [];
    for (const r of selected) {
      const base = {
        side: r.side,
        quantity: Number(r.quantity),
        price: Number(r.price),
        commission: Number(r.commission),
        currency: r.currency,
        tradeDate: r.tradeDate,
      };
      if (r.securityChoice === NEW_SECURITY) {
        if (!r.newSymbol.trim()) {
          toast.error(`Enter a symbol for "${r.securityName}"`);
          return;
        }
        orders.push({
          ...base,
          newSecurity: {
            symbol: r.newSymbol.trim(),
            name: r.newName.trim() || r.securityName,
            exchange: r.newExchange.trim() || undefined,
            currency: r.newCurrency || r.currency,
          },
        });
      } else if (r.securityChoice) {
        orders.push({ ...base, securityId: r.securityChoice });
      } else {
        toast.error(`Pick a security for "${r.securityName}"`);
        return;
      }
    }

    setApplying(true);
    try {
      const res = await brokerImportApi.apply({ accountId, orders });
      const errorNote =
        res.errors.length > 0 ? `, ${res.errors.length} error(s)` : '';
      toast.success(
        `Added ${res.created} trade(s), ${res.securitiesCreated} new securit${
          res.securitiesCreated === 1 ? 'y' : 'ies'
        }, ${res.skipped} skipped${errorNote}`,
      );
      // Drop the rows we just applied, keep any deselected rows for review.
      setRows((prev) => prev.filter((r) => !r.include));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add the trades'));
    } finally {
      setApplying(false);
    }
  };

  const busy = parsing || applying;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <label
          htmlFor="broker-paste"
          className="block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Paste your brokerage order history
        </label>
        <textarea
          id="broker-paste"
          aria-label="Paste your brokerage order history"
          onPaste={handlePaste}
          // The captured HTML lives in state; show plain text in the box so the
          // user sees that something was captured without exposing raw markup.
          value={captureKind === 'html' ? '' : capturedHtml}
          onChange={(e) => {
            // Allow typing/clearing as plain text (e.g. to reset the box).
            setCapturedHtml(e.target.value);
            setCaptureKind(e.target.value ? 'text' : null);
          }}
          placeholder="Copy the order/trade table from your broker's website and paste it here. The structured HTML table is captured automatically."
          rows={6}
          disabled={busy}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3">
          <p
            className="text-xs text-gray-500 dark:text-gray-400"
            aria-live="polite"
          >
            {captureHint ?? 'Nothing captured yet'}
          </p>
          <Button
            onClick={runParse}
            isLoading={parsing}
            disabled={busy || !capturedHtml}
          >
            {parsing ? 'Parsing...' : 'Parse'}
          </Button>
        </div>
      </section>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Parser warnings
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="w-full sm:w-80">
              <Select
                label="Target account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={busy}
                options={accountOptions}
              />
            </div>
          </div>

          <section className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">Add</th>
                  <th className="px-3 py-2">Security</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Commission</th>
                  <th className="px-3 py-2">Currency</th>
                  <th className="px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((row) => {
                  const isNew = row.securityChoice === NEW_SECURITY;
                  return (
                    <tr
                      key={row.rowId}
                      className={row.include ? '' : 'opacity-50'}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={() =>
                            updateRow(row.rowId, { include: !row.include })
                          }
                          disabled={busy}
                          aria-label={`Add ${row.securityName}`}
                          className="mt-2 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                        />
                      </td>
                      <td className="px-3 py-2 align-top min-w-[16rem]">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          {row.securityName}
                        </div>
                        <Combobox
                          options={securityOptions}
                          value={row.securityChoice}
                          onChange={(value) =>
                            updateRow(row.rowId, { securityChoice: value })
                          }
                          disabled={busy}
                          placeholder="Choose a security"
                        />
                        {isNew && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Input
                              label="Symbol"
                              value={row.newSymbol}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  newSymbol: e.target.value,
                                })
                              }
                              disabled={busy}
                              placeholder="e.g. AAPL"
                              aria-label={`Symbol for ${row.securityName}`}
                            />
                            <Input
                              label="Name"
                              value={row.newName}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  newName: e.target.value,
                                })
                              }
                              disabled={busy}
                            />
                            <Input
                              label="Exchange"
                              value={row.newExchange}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  newExchange: e.target.value,
                                })
                              }
                              disabled={busy}
                            />
                            <Input
                              label="Currency"
                              value={row.newCurrency}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  newCurrency: e.target.value,
                                })
                              }
                              disabled={busy}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top w-28">
                        <Select
                          aria-label={`Side for ${row.securityName}`}
                          value={row.side}
                          onChange={(e) =>
                            updateRow(row.rowId, {
                              side: e.target.value as 'BUY' | 'SELL',
                            })
                          }
                          disabled={busy}
                          options={[
                            { value: 'BUY', label: 'BUY' },
                            { value: 'SELL', label: 'SELL' },
                          ]}
                        />
                      </td>
                      <td className="px-3 py-2 align-top w-28">
                        <Input
                          type="number"
                          aria-label={`Quantity for ${row.securityName}`}
                          value={row.quantity}
                          onChange={(e) =>
                            updateRow(row.rowId, { quantity: e.target.value })
                          }
                          disabled={busy}
                        />
                      </td>
                      <td className="px-3 py-2 align-top w-28">
                        <Input
                          type="number"
                          aria-label={`Price for ${row.securityName}`}
                          value={row.price}
                          onChange={(e) =>
                            updateRow(row.rowId, { price: e.target.value })
                          }
                          disabled={busy}
                        />
                      </td>
                      <td className="px-3 py-2 align-top w-28">
                        <Input
                          type="number"
                          aria-label={`Commission for ${row.securityName}`}
                          value={row.commission}
                          onChange={(e) =>
                            updateRow(row.rowId, {
                              commission: e.target.value,
                            })
                          }
                          disabled={busy}
                        />
                      </td>
                      <td className="px-3 py-2 align-top w-24">
                        <Input
                          aria-label={`Currency for ${row.securityName}`}
                          value={row.currency}
                          onChange={(e) =>
                            updateRow(row.rowId, { currency: e.target.value })
                          }
                          disabled={busy}
                        />
                      </td>
                      <td className="px-3 py-2 align-top w-40">
                        <Input
                          type="date"
                          aria-label={`Date for ${row.securityName}`}
                          value={row.tradeDate}
                          onChange={(e) =>
                            updateRow(row.rowId, { tradeDate: e.target.value })
                          }
                          disabled={busy}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="flex justify-end">
            <Button
              onClick={applySelected}
              isLoading={applying}
              disabled={busy}
            >
              {applying ? 'Adding...' : 'Add selected'}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Paste your order history above and click Parse to review the trades.
        </p>
      )}
    </div>
  );
}
