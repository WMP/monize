/**
 * The client address the deployment's edge asserted, for the proxy to pass on
 * to the backend -- or `null` when nothing asserted one.
 *
 * Next.js middleware has no access to the connecting socket (`NextRequest.ip`
 * was Vercel-only and was removed in Next 15), so the ONLY thing this layer can
 * know about the client's address is what something in front of it put in a
 * header. Two conventions cover the reverse proxies this stack is deployed
 * behind: `X-Real-IP` (nginx, ingress-nginx) and `X-Forwarded-For` (Traefik,
 * most cloud load balancers, and ingress-nginx as well).
 *
 * `X-Forwarded-For` is read at its FIRST entry, which is the conventional
 * position for the originating client -- each hop appends the peer it heard
 * from, so the list reads client, then edge, then any hop after it.
 *
 * ## What this is and is not
 *
 * Neither header is authenticated: a browser can send both. That is a property
 * of the deployment, not of this function -- an edge proxy is expected to
 * overwrite them, and where none does, this value is an assertion by whoever
 * sent the request. The proxy's job is only to stop a client-supplied header
 * from being *silently* promoted: it forwards this value or, when there is
 * none, forwards no `X-Forwarded-For` at all, so the browser's own can never
 * reach the backend unaltered.
 *
 * `null` is the important half of the contract. The predecessor of this
 * function fell back to the literal `"127.0.0.1"`, which every deployment
 * without an `X-Real-IP`-setting edge then recorded against every registration
 * and every trusted device -- an address nobody was at, indistinguishable from
 * a genuine loopback connection. Unknown is a state; a consumer has to be able
 * to say so.
 */
export function assertedClientAddress(headers: Headers): string | null {
  const realIp = firstAddress(headers.get('x-real-ip'));
  if (realIp) return realIp;
  return firstAddress(headers.get('x-forwarded-for'));
}

/** The first entry of a comma-separated address list, trimmed; null when empty. */
function firstAddress(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}
