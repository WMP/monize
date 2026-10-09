'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isPublicPath } from '@/lib/public-paths';
import type { MessageScope } from '@/i18n/client-messages';

/**
 * Keeps a signed-out page's trimmed catalog from reaching the signed-in app.
 *
 * The root layout picks the client catalog once, on the request that loaded
 * the document, and a soft navigation does not re-render it. So a sign-in on
 * /login followed by `router.push('/dashboard')` would render the app with
 * only the public namespaces. When the path leaves the public pages under a
 * public catalog, this renders nothing and refreshes: the refresh re-renders
 * the root layout for the new path, which hands over every namespace, and the
 * scope prop flips to 'full'.
 *
 * The landing path is exempt so a not-found page for a path the proxy never
 * saw (which is rendered with the public catalog) still renders.
 */
export function MessageScopeGuard({
  scope,
  children,
}: {
  scope: MessageScope;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [landingPath] = useState(pathname);
  const needsFullCatalog =
    scope === 'public' && pathname !== landingPath && !isPublicPath(pathname);

  useEffect(() => {
    if (needsFullCatalog) router.refresh();
  }, [needsFullCatalog, router]);

  return needsFullCatalog ? null : <>{children}</>;
}
