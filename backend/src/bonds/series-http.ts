import { Injectable } from "@nestjs/common";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { TrackedProviderId } from "../provider-health/providers";
import { BondFetch } from "./bond-adapter";

export type HttpFetch = typeof globalThis.fetch;

export const SERIES_FETCH_TIMEOUT_MS = 30_000;
/** The largest body read: the issue letter PDF; an HTML page is far smaller. */
export const SERIES_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** A body that ran past the cap: the read stopped and nothing was returned. */
export class SeriesBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The response body is larger than ${maxBytes} bytes`);
    this.name = "SeriesBodyTooLargeError";
  }
}

/**
 * The whole body as bytes, read as a stream with a hard cap: the declared length
 * is refused before a byte is read, and a body that does not declare one (or
 * lies) is cancelled the moment the running total passes `maxBytes`, so an
 * oversized or endless answer never sits in memory.
 */
export async function readCapped(
  response: Pick<Response, "body" | "headers">,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new SeriesBodyTooLargeError(maxBytes);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SeriesBodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The most redirects one benchmark request follows. */
export const FETCH_MAX_REDIRECTS = 3;

/**
 * Where a request may go. Given, the door refuses every URL (the first and each
 * redirect target) that is not https on one of `allowedHosts` (exact host names,
 * default port, no credentials) and follows redirects between those hosts only,
 * at most `FETCH_MAX_REDIRECTS` of them. Absent, no redirect is followed and the
 * adapter judges the host itself (the series fetch, `getFromIssuer`).
 */
export interface FetchPolicy {
  readonly allowedHosts: readonly string[];
}

/** A request the policy refused: counted against nothing, no socket was opened for it. */
export class FetchRefusedError extends Error {
  constructor(readonly reason: "scheme" | "host" | "redirects") {
    super(`The request was refused by the fetch policy: ${reason}`);
    this.name = "FetchRefusedError";
  }
}

function allowedTarget(
  target: string,
  policy: FetchPolicy,
  base?: string,
): string {
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    throw new FetchRefusedError("scheme");
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new FetchRefusedError("scheme");
  }
  if (!policy.allowedHosts.includes(url.hostname)) {
    throw new FetchRefusedError("host");
  }
  return url.toString();
}

/**
 * The network door of every bond fetch (series and benchmarks): the one place
 * that calls `fetch`. An adapter is a pure function of what this returns, so the
 * redirect rule, the size cap and the timeout live here and the breaker gates
 * every request.
 *
 * Redirects are never followed by `fetch` itself (`redirect: "manual"`). Without
 * a `FetchPolicy` the answer is returned with its 3xx status (the adapter
 * refuses anything but 200) and `url` is the address that was asked; with one,
 * the door follows a redirect that stays on the policy's https hosts (see
 * `FetchPolicy`) and returns the final answer with its own `url`.
 */
@Injectable()
export class SeriesHttp {
  constructor(private readonly health: ProviderHealthService) {}

  /**
   * The fetch an adapter receives, behind the provider's circuit breaker: a
   * refusal throws before any socket is opened, a transport failure is counted,
   * and success is recorded only once the whole body has arrived.
   */
  gated(
    providerId: TrackedProviderId,
    http?: HttpFetch,
    policy?: FetchPolicy,
  ): BondFetch {
    return async (url) => {
      // A refused address costs the breaker nothing: no admission is taken.
      let target = policy ? allowedTarget(url, policy) : url;
      const admission = this.health.assertAvailable(providerId);
      let status: number;
      let body: Uint8Array;
      let finalUrl: string;
      try {
        // A test injects `http`; production calls the global fetch here, in the
        // one place provider-call.guard.spec.ts scans for its breaker.
        const call = (to: string) => {
          const init = {
            redirect: "manual" as const,
            signal: AbortSignal.timeout(SERIES_FETCH_TIMEOUT_MS),
          };
          return http ? http(to, init) : fetch(to, init);
        };
        let response = await call(target);
        for (let hops = 0; policy; hops += 1) {
          const location = response.headers.get("location");
          if (response.status < 300 || response.status >= 400 || !location) {
            break;
          }
          await response.body?.cancel();
          if (hops >= FETCH_MAX_REDIRECTS) {
            throw new FetchRefusedError("redirects");
          }
          target = allowedTarget(location, policy, target);
          response = await call(target);
        }
        status = response.status;
        finalUrl = response.url || target;
        body = await readCapped(response, SERIES_MAX_BODY_BYTES);
      } catch (error) {
        if (error instanceof FetchRefusedError) {
          if (admission === "probe") this.health.releaseProbe(providerId);
          throw error;
        }
        const counted = this.health.recordFailure(providerId, error);
        if (!counted && admission === "probe")
          this.health.releaseProbe(providerId);
        throw error;
      }
      this.health.recordSuccess(providerId);
      return { status, body, url: finalUrl };
    };
  }
}
