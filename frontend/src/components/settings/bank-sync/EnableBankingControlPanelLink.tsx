import type { ReactNode } from 'react';
import { ENABLE_BANKING_CONTROL_PANEL_URL } from '@/lib/bank-sync-links';

/**
 * The link to the Enable Banking control panel, shared by the credentials card
 * and its modal so `target` and `rel` cannot drift between them. `noopener` is
 * the security control: without it the opened page gets a handle on this one
 * through `window.opener`.
 */
export function EnableBankingControlPanelLink({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <a
      href={ENABLE_BANKING_CONTROL_PANEL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
    >
      {children}
    </a>
  );
}
