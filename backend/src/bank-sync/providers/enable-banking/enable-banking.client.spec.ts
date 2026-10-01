import { generateKeyPairSync } from "node:crypto";
import { Logger } from "@nestjs/common";
import { ProviderHealthService } from "../../../provider-health/provider-health.service";
import { ProviderUnavailableError } from "../../../provider-health/provider-unavailable.error";
import { BankSyncProviderError } from "../bank-sync-provider.errors";
import type { BankSyncCredentials } from "../bank-sync-provider.interface";
import {
  ENABLE_BANKING_BASE_URL,
  ENABLE_BANKING_PROVIDER,
  EnableBankingProvider,
  MAX_TRANSACTION_PAGES,
} from "./enable-banking.client";

/**
 * The adapter is the one place this deployment talks to Enable Banking, so the
 * tests are about what a `fetch` double can genuinely prove: the request that is
 * sent (URL, method, headers, body), the pagination, the mapping of every
 * failure to a typed error, and the breaker bookkeeping each outcome owes --
 * where a held probe slot against a provider that just answered would take it
 * down for two minutes with nothing wrong with it.
 */

type HealthMethod =
  | "assertAvailable"
  | "recordSuccess"
  | "recordFailure"
  | "releaseProbe"
  | "logFailure";

/** Each double has the real method's parameters and return type. */
type HealthDouble = {
  [K in HealthMethod]: jest.Mock<
    ReturnType<ProviderHealthService[K]>,
    Parameters<ProviderHealthService[K]>
  >;
};

function healthDouble(): HealthDouble {
  return {
    assertAvailable: jest
      .fn<
        ReturnType<ProviderHealthService["assertAvailable"]>,
        Parameters<ProviderHealthService["assertAvailable"]>
      >()
      .mockReturnValue("open-gate"),
    recordSuccess: jest.fn(),
    recordFailure: jest
      .fn<
        ReturnType<ProviderHealthService["recordFailure"]>,
        Parameters<ProviderHealthService["recordFailure"]>
      >()
      .mockReturnValue(true),
    releaseProbe: jest.fn(),
    logFailure: jest.fn(),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const APPLICATION_ID = "00000000-0000-4000-8000-000000000001";

describe("EnableBankingProvider", () => {
  let credentials: BankSyncCredentials;
  let health: HealthDouble;
  let provider: EnableBankingProvider;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    credentials = {
      applicationId: APPLICATION_ID,
      privateKeyPem: privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string,
    };
  });

  beforeEach(() => {
    health = healthDouble();
    provider = new EnableBankingProvider(
      health as unknown as ProviderHealthService,
    );
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /** The n-th call's URL, init, and its headers as a plain object. */
  const call = (n = 0) => {
    const [input, init] = fetchSpy.mock.calls[n];
    return {
      url: new URL(String(input)),
      init: init ?? {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
  };

  const tokenOf = (n = 0): string =>
    call(n).headers.Authorization.replace(/^Bearer /, "");

  const errorOf = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error("expected the call to reject");
  };

  describe("the request", () => {
    it("signs every call with a Bearer JWT whose kid is the application id", async () => {
      fetchSpy.mockResolvedValueOnce(json({ name: "App", redirect_urls: [] }));

      await provider.testCredentials(credentials);

      const { url, init, headers } = call();
      expect(url.href).toBe(`${ENABLE_BANKING_BASE_URL}/application`);
      expect(init.method).toBe("GET");
      expect(headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(headers.Accept).toBe("application/json");
      const header = JSON.parse(
        Buffer.from(tokenOf().split(".")[0], "base64url").toString(),
      );
      expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: APPLICATION_ID });
      expect(init.body).toBeUndefined();
    });

    it("passes a timeout signal", async () => {
      fetchSpy.mockResolvedValueOnce(json({}));
      await provider.testCredentials(credentials);
      expect(call().init.signal).toBeInstanceOf(AbortSignal);
    });

    it("testCredentials maps the application", async () => {
      // A GetApplicationResponse (API reference, GET /application).
      fetchSpy.mockResolvedValueOnce(
        json({
          name: "My App",
          description: "Personal finance",
          kid: APPLICATION_ID,
          environment: "PRODUCTION",
          redirect_urls: ["https://app.example/cb"],
          active: true,
          countries: ["PL"],
          services: ["AIS"],
        }),
      );
      await expect(provider.testCredentials(credentials)).resolves.toEqual({
        applicationName: "My App",
        redirectUrls: ["https://app.example/cb"],
      });
    });

    it("listInstitutions sends the country as an encoded query parameter", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({ aspsps: [{ name: "Example Bank", country: "PL" }] }),
      );

      const result = await provider.listInstitutions(credentials, "P&L");

      expect(call().url.pathname).toBe("/aspsps");
      // Only banks offering account information (`service=AIS`).
      expect(call().url.search).toBe("?country=P%26L&service=AIS");
      expect(result.map((bank) => bank.name)).toEqual(["Example Bank"]);
    });

    it("startAuthorization POSTs the flow and returns the bank's URL", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({ url: "https://bank.example/auth" }),
      );

      const result = await provider.startAuthorization(credentials, {
        institutionName: "Example Bank",
        country: "PL",
        redirectUrl: "https://monize.example/settings/bank-sync/callback",
        state: "state-123",
        validUntil: new Date("2026-06-01T12:00:00.000Z"),
        psuType: "personal",
      });

      expect(result).toEqual({ url: "https://bank.example/auth" });
      const { url, init, headers } = call();
      expect(url.pathname).toBe("/auth");
      expect(init.method).toBe("POST");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual({
        access: { valid_until: "2026-06-01T12:00:00.000Z" },
        aspsp: { name: "Example Bank", country: "PL" },
        state: "state-123",
        redirect_url: "https://monize.example/settings/bank-sync/callback",
        psu_type: "personal",
      });
    });

    it("startAuthorization refuses a URL that is not https", async () => {
      fetchSpy.mockResolvedValueOnce(json({ url: "http://bank.example/auth" }));
      const error = await errorOf(
        provider.startAuthorization(credentials, {
          institutionName: "Example Bank",
          country: "PL",
          redirectUrl: "https://monize.example/cb",
          state: "s",
          validUntil: new Date(),
          psuType: "business",
        }),
      );
      expect(error).toMatchObject({ kind: "invalid_response" });
    });

    it("completeAuthorization POSTs the code and maps the session", async () => {
      fetchSpy.mockResolvedValueOnce(
        // An AuthorizeSessionResponse (API reference, POST /sessions).
        json({
          session_id: "session-1",
          access: { valid_until: "2026-06-01T12:00:00Z" },
          aspsp: { name: "Example Bank", country: "PL" },
          psu_type: "personal",
          accounts: [
            {
              uid: "uid-1",
              identification_hash: "hash-1",
              identification_hashes: ["hash-1"],
              cash_account_type: "CACC",
              currency: "PLN",
            },
          ],
        }),
      );

      const result = await provider.completeAuthorization(
        credentials,
        "code-1",
      );

      expect(JSON.parse(String(call().init.body))).toEqual({ code: "code-1" });
      expect(call().url.pathname).toBe("/sessions");
      expect(result.sessionId).toBe("session-1");
      expect(result.validUntil).toEqual(new Date("2026-06-01T12:00:00.000Z"));
      expect(result.accounts.map((a) => a.externalAccountId)).toEqual([
        "uid-1",
      ]);
    });

    it("fetchBalance reads the balances of an encoded account id", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({
          balances: [
            {
              balance_type: "CLBD",
              balance_amount: { amount: "100.50", currency: "PLN" },
            },
          ],
        }),
      );

      const balance = await provider.fetchBalance(credentials, "uid/1", null);

      expect(call().url.pathname).toBe("/accounts/uid%2F1/balances");
      expect(balance).toMatchObject({ amount: "100.50", currencyCode: "PLN" });
    });

    it("fetchBalance is null when the bank reported none", async () => {
      fetchSpy.mockResolvedValueOnce(json({ balances: [] }));
      await expect(
        provider.fetchBalance(credentials, "uid-1", null),
      ).resolves.toBeNull();
    });

    it("revokeSession DELETEs the encoded session with no body", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await expect(
        provider.revokeSession(credentials, "sess/1?x=y"),
      ).resolves.toBeUndefined();

      const { url, init, headers } = call();
      expect(url.pathname).toBe("/sessions/sess%2F1%3Fx%3Dy");
      expect(url.search).toBe("");
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
      expect(headers["Content-Type"]).toBeUndefined();
      expect(health.recordSuccess).toHaveBeenCalledTimes(1);
    });

    it("revokeSession reports a refusal", async () => {
      fetchSpy.mockResolvedValueOnce(json({ message: "boom" }, 500));
      await expect(
        provider.revokeSession(credentials, "sess-1"),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });

  describe("fetchTransactions", () => {
    const window = { dateFrom: "2026-03-01", dateTo: "2026-03-20" };
    const wire = (reference: string, status = "BOOK") => ({
      entry_reference: reference,
      status,
      booking_date: "2026-03-10",
      transaction_amount: { amount: "1.00", currency: "EUR" },
      credit_debit_indicator: "DBIT",
    });

    it("asks for booked rows in the window and follows the continuation key", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          json({ transactions: [wire("E-1")], continuation_key: "page-2" }),
        )
        .mockResolvedValueOnce(
          json({ transactions: [wire("E-2")], continuation_key: "page-3" }),
        )
        .mockResolvedValueOnce(json({ transactions: [wire("E-3")] }));

      const rows = await provider.fetchTransactions(
        credentials,
        "uid/1",
        window,
        null,
      );

      expect(rows.map((row) => row.entryReference)).toEqual([
        "E-1",
        "E-2",
        "E-3",
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      for (const n of [0, 1, 2]) {
        expect(call(n).url.pathname).toBe("/accounts/uid%2F1/transactions");
        expect(call(n).url.searchParams.get("date_from")).toBe("2026-03-01");
        expect(call(n).url.searchParams.get("date_to")).toBe("2026-03-20");
        expect(call(n).url.searchParams.get("transaction_status")).toBe("BOOK");
      }
      expect(call(0).url.searchParams.has("continuation_key")).toBe(false);
      expect(call(1).url.searchParams.get("continuation_key")).toBe("page-2");
      expect(call(2).url.searchParams.get("continuation_key")).toBe("page-3");
      // Every page went through the breaker.
      expect(health.assertAvailable).toHaveBeenCalledTimes(3);
      expect(health.recordSuccess).toHaveBeenCalledTimes(3);
    });

    describe("date_from, which the reference reads in UTC", () => {
      const atUtc = async (now: string, dateFrom: string, dateTo: string) => {
        fetchSpy.mockClear();
        jest.useFakeTimers({
          now: new Date(now),
          // Only the clock is faked: the request path owns timers of its own.
          doNotFake: [
            "nextTick",
            "setImmediate",
            "clearImmediate",
            "setInterval",
            "clearInterval",
            "setTimeout",
            "clearTimeout",
            "queueMicrotask",
          ],
        });
        try {
          fetchSpy.mockResolvedValueOnce(json({ transactions: [] }));
          await provider.fetchTransactions(
            credentials,
            "uid-1",
            { dateFrom, dateTo },
            null,
          );
        } finally {
          jest.useRealTimers();
        }
        return {
          from: call().url.searchParams.get("date_from"),
          to: call().url.searchParams.get("date_to"),
        };
      };

      it("is never after today in UTC (DATE_FROM_IN_FUTURE), even when the user's day is ahead", async () => {
        // 23:30 UTC on the 20th is already the 21st for a user east of UTC.
        expect(
          await atUtc("2026-03-20T23:30:00Z", "2026-03-21", "2026-03-21"),
        ).toEqual({
          from: "2026-03-20",
          to: "2026-03-21",
        });
      });

      it("is left alone on, and before, today in UTC", async () => {
        expect(
          await atUtc("2026-03-21T00:30:00Z", "2026-03-21", "2026-03-21"),
        ).toEqual({
          from: "2026-03-21",
          to: "2026-03-21",
        });
        expect(
          await atUtc("2026-03-21T12:00:00Z", "2026-03-01", "2026-03-21"),
        ).toEqual({
          from: "2026-03-01",
          to: "2026-03-21",
        });
      });
    });

    it("also drops a row that is not booked, whatever the parameter asked", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({
          transactions: [wire("E-1"), wire("E-2", "PDNG"), wire("E-3", "INFO")],
        }),
      );
      const rows = await provider.fetchTransactions(
        credentials,
        "uid-1",
        window,
        null,
      );
      expect(rows.map((row) => row.entryReference)).toEqual(["E-1"]);
    });

    it("returns an empty list for an answer that says there is nothing", async () => {
      fetchSpy.mockResolvedValueOnce(json({ transactions: [] }));
      await expect(
        provider.fetchTransactions(credentials, "uid-1", window, null),
      ).resolves.toEqual([]);
    });

    it("fails rather than truncate when the pages never end", async () => {
      let n = 0;
      fetchSpy.mockImplementation(async () =>
        json({ transactions: [], continuation_key: `key-${n++}` }),
      );

      const error = await errorOf(
        provider.fetchTransactions(credentials, "uid-1", window, null),
      );

      expect(error).toBeInstanceOf(BankSyncProviderError);
      expect(error).toMatchObject({ kind: "invalid_response" });
      expect(fetchSpy).toHaveBeenCalledTimes(MAX_TRANSACTION_PAGES);
    });

    it("stops a provider that hands the same key back", async () => {
      fetchSpy.mockImplementation(async () =>
        json({ transactions: [], continuation_key: "same" }),
      );
      const error = await errorOf(
        provider.fetchTransactions(credentials, "uid-1", window, null),
      );
      expect(error).toMatchObject({ kind: "invalid_response" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("raises invalid_response, not an empty list, for a body with no transactions key", async () => {
      fetchSpy.mockResolvedValueOnce(json({ unexpected: true }));
      const error = await errorOf(
        provider.fetchTransactions(credentials, "uid-1", window, null),
      );
      expect(error).toMatchObject({ kind: "invalid_response" });
    });

    it("gives up on the first failing page, keeping nothing", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          json({ transactions: [wire("E-1")], continuation_key: "page-2" }),
        )
        .mockResolvedValueOnce(json({ message: "slow down" }, 429));
      const error = await errorOf(
        provider.fetchTransactions(credentials, "uid-1", window, null),
      );
      expect(error).toMatchObject({ kind: "rate_limited" });
    });
  });

  describe("PSU headers", () => {
    const psu = { ipAddress: "192.0.2.10", userAgent: "ExampleBrowser/1.0" };

    it("are sent on a user-present read", async () => {
      fetchSpy.mockResolvedValue(json({ transactions: [] }));
      await provider.fetchTransactions(
        credentials,
        "uid-1",
        { dateFrom: "2026-03-01", dateTo: "2026-03-20" },
        psu,
      );
      expect(call().headers["Psu-Ip-Address"]).toBe("192.0.2.10");
      expect(call().headers["Psu-User-Agent"]).toBe("ExampleBrowser/1.0");
    });

    it("are sent on a balance read too", async () => {
      fetchSpy.mockResolvedValue(json({ balances: [] }));
      await provider.fetchBalance(credentials, "uid-1", psu);
      expect(call().headers["Psu-Ip-Address"]).toBe("192.0.2.10");
    });

    it("are absent for an unattended read", async () => {
      fetchSpy.mockResolvedValue(json({ transactions: [] }));
      await provider.fetchTransactions(
        credentials,
        "uid-1",
        { dateFrom: "2026-03-01", dateTo: "2026-03-20" },
        null,
      );
      expect(call().headers["Psu-Ip-Address"]).toBeUndefined();
      expect(call().headers["Psu-User-Agent"]).toBeUndefined();
    });

    it("are reduced to printable ASCII, bounded, and omitted when nothing is left", async () => {
      fetchSpy.mockImplementation(async () => json({ balances: [] }));
      await provider.fetchBalance(credentials, "uid-1", {
        ipAddress: "192.0.2.10\r\nX-Injected: 1",
        userAgent: "Agent\u0000é中" + "x".repeat(600),
      });
      const { headers } = call();
      expect(headers["Psu-Ip-Address"]).toBe("192.0.2.10 X-Injected: 1");
      expect(headers["Psu-User-Agent"]).toMatch(/^[ -~]+$/);
      expect(headers["Psu-User-Agent"].length).toBeLessThanOrEqual(256);

      fetchSpy.mockClear();
      await provider.fetchBalance(credentials, "uid-1", {
        ipAddress: "",
        userAgent: "é中",
      });
      expect(call().headers["Psu-Ip-Address"]).toBeUndefined();
      expect(call().headers["Psu-User-Agent"]).toBeUndefined();
    });
  });

  describe("HTTP status mapping", () => {
    /** An account read and the application check; neither is classified by who calls. */
    const sessionCall = () => provider.fetchBalance(credentials, "uid-1", null);
    const applicationCall = () => provider.testCredentials(credentials);

    // The shapes are the reference's ErrorResponse: `message`, an integer
    // `code` that repeats the HTTP status, and the text `error` (ErrorCode).
    // The two answers without an `error` were observed from the live gateway
    // for an unknown application id and a missing Authorization header.
    it.each([
      [
        "403 'Application does not exist' (no error code) on an application call",
        403,
        { code: 403, message: "Application does not exist" },
        false,
        "unauthorized",
      ],
      [
        "403 'Application does not exist' (no error code) on a session call is not an expired consent",
        403,
        { code: 403, message: "Application does not exist" },
        true,
        "unauthorized",
      ],
      [
        "401 without an Authorization header",
        401,
        { code: 401, message: "Authorization header is not provided" },
        false,
        "unauthorized",
      ],
      [
        "401 UNAUTHORIZED_ACCESS",
        401,
        { code: 401, error: "UNAUTHORIZED_ACCESS", message: "Unauthorized" },
        true,
        "unauthorized",
      ],
      [
        "403 ACCESS_DENIED on a session call is not an expired consent",
        403,
        { code: 403, error: "ACCESS_DENIED", message: "Access denied" },
        true,
        "unauthorized",
      ],
      [
        "401 EXPIRED_SESSION",
        401,
        { code: 401, error: "EXPIRED_SESSION", message: "Session is expired" },
        true,
        "session_expired",
      ],
      [
        "REVOKED_SESSION, whatever the status",
        403,
        { code: 403, error: "REVOKED_SESSION", message: "Session is revoked" },
        true,
        "session_expired",
      ],
      [
        "CLOSED_SESSION, whatever the status",
        422,
        { code: 422, error: "CLOSED_SESSION", message: "Session is closed" },
        true,
        "session_expired",
      ],
      [
        "SESSION_DOES_NOT_EXIST",
        404,
        { code: 404, error: "SESSION_DOES_NOT_EXIST", message: "No session" },
        true,
        "session_expired",
      ],
      [
        "UNAUTHORIZED_IP, whatever the status",
        403,
        {
          code: 403,
          error: "UNAUTHORIZED_IP",
          message: "Used IP address is not authorized to access the resource",
        },
        false,
        "ip_not_allowed",
      ],
      [
        "NO_ACCOUNTS_ADDED, whatever the status",
        422,
        {
          code: 422,
          error: "NO_ACCOUNTS_ADDED",
          message: "No allowed accounts added to the application",
        },
        true,
        "no_accounts_linked",
      ],
      [
        "WRONG_TRANSACTIONS_PERIOD",
        422,
        {
          code: 422,
          error: "WRONG_TRANSACTIONS_PERIOD",
          message: "Wrong transactions period requested",
        },
        true,
        "period_unavailable",
      ],
      [
        "429 ASPSP_RATE_LIMIT_EXCEEDED",
        429,
        {
          code: 429,
          error: "ASPSP_RATE_LIMIT_EXCEEDED",
          message: "ASPSP Rate limit exceeded",
        },
        true,
        "rate_limited",
      ],
      [
        "ASPSP_RATE_LIMIT_EXCEEDED under another status",
        400,
        { code: 400, error: "ASPSP_RATE_LIMIT_EXCEEDED", message: "Slow down" },
        true,
        "rate_limited",
      ],
      ["429 with no code", 429, { message: "too many" }, true, "rate_limited"],
      [
        "ASPSP_ERROR is the bank failing: retry later, whatever the status",
        400,
        { code: 400, error: "ASPSP_ERROR", message: "Error interacting" },
        true,
        "unavailable",
      ],
      [
        "ASPSP_TIMEOUT is the bank not answering",
        408,
        { code: 408, error: "ASPSP_TIMEOUT", message: "Timeout" },
        true,
        "unavailable",
      ],
      [
        "408 with no code",
        408,
        { code: 408, message: "Timeout" },
        true,
        "unavailable",
      ],
      [
        "422 PSU_HEADER_NOT_PROVIDED stays a rejected request",
        422,
        {
          code: 422,
          error: "PSU_HEADER_NOT_PROVIDED",
          message: "Required PSU header is not provided",
          detail: "PSU header psuIpAddress is not provided",
        },
        true,
        "bad_request",
      ],
      [
        "400 WRONG_CONTINUATION_KEY",
        400,
        { code: 400, error: "WRONG_CONTINUATION_KEY", message: "Wrong key" },
        true,
        "bad_request",
      ],
      ["400", 400, { message: "bad" }, false, "bad_request"],
      ["404", 404, { message: "no such thing" }, true, "bad_request"],
      ["422", 422, {}, false, "bad_request"],
      ["401 with no body on a session call", 401, null, true, "unauthorized"],
      ["500", 500, {}, true, "unavailable"],
      ["502", 502, "<html>bad gateway</html>", false, "unavailable"],
      ["503", 503, {}, true, "unavailable"],
    ] as const)("%s maps to %s", async (_label, status, body, scoped, kind) => {
      fetchSpy.mockResolvedValueOnce(
        typeof body === "string"
          ? new Response(body, { status })
          : body === null
            ? new Response(null, { status })
            : json(body, status),
      );

      const error = await errorOf(scoped ? sessionCall() : applicationCall());

      expect(error).toBeInstanceOf(BankSyncProviderError);
      expect(error).toMatchObject({ kind, status });
    });

    it("carries the status, the provider's code and a bounded description", async () => {
      fetchSpy.mockResolvedValueOnce(
        json(
          {
            error: "WRONG_REQUEST_PARAMETERS",
            message: `Bank said no. ${"x".repeat(500)}`,
          },
          400,
        ),
      );
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error.providerCode).toBe("WRONG_REQUEST_PARAMETERS");
      expect(error.message).toMatch(
        /^Enable Banking returned HTTP 400: WRONG_REQUEST_PARAMETERS \(Bank said no\. x+\)$/,
      );
      expect(error.message.length).toBeLessThanOrEqual(300);
    });

    it("takes the code from `error` only: the integer `code` is the status again", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({ code: 400, message: "line1\nline2\u0000" }, 400),
      );
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error.providerCode).toBeNull();
      expect(error.message).toBe(
        "Enable Banking returned HTTP 400 (line1 line2)",
      );
    });

    it("upper-cases the error code and falls back to `detail` when there is no message", async () => {
      fetchSpy.mockResolvedValueOnce(
        json(
          { error: "psu_header_invalid", detail: "PSU header is invalid" },
          422,
        ),
      );
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error.providerCode).toBe("PSU_HEADER_INVALID");
      expect(error.message).toBe(
        "Enable Banking returned HTTP 422: PSU_HEADER_INVALID (PSU header is invalid)",
      );
    });

    it("ignores a `detail` that is not text", async () => {
      fetchSpy.mockResolvedValueOnce(
        json({ error: "WRONG_REQUEST_PARAMETERS", detail: { x: 1 } }, 400),
      );
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error.message).toBe(
        "Enable Banking returned HTTP 400: WRONG_REQUEST_PARAMETERS",
      );
    });

    it("never repeats the signed token, even when the provider echoes it", async () => {
      fetchSpy.mockImplementationOnce(async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        const token = headers.Authorization.replace(/^Bearer /, "");
        return json({ error: "BAD_JWT", message: `rejected ${token}` }, 401);
      });
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error.message).toContain("[redacted]");
      expect(error.message).not.toContain(tokenOf());
      expect(error.message).not.toContain("PRIVATE KEY");
    });

    it("is still a typed error when the body cannot be read at all", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("not json", { status: 400 }));
      const error = (await errorOf(applicationCall())) as BankSyncProviderError;
      expect(error).toMatchObject({ kind: "bad_request", providerCode: null });
      expect(error.message).toBe("Enable Banking returned HTTP 400");
    });
  });

  describe("health bookkeeping", () => {
    it("reports under the tracked id", () => {
      expect(ENABLE_BANKING_PROVIDER).toBe("enable_banking");
      expect(provider.name).toBe("enable_banking");
    });

    it("admits, then records success once for an answered call", async () => {
      fetchSpy.mockResolvedValueOnce(json({}));
      await provider.testCredentials(credentials);

      expect(health.assertAvailable).toHaveBeenCalledWith("enable_banking");
      expect(health.recordSuccess).toHaveBeenCalledTimes(1);
      expect(health.recordSuccess).toHaveBeenCalledWith("enable_banking");
      expect(health.recordFailure).not.toHaveBeenCalled();
      expect(health.logFailure).not.toHaveBeenCalled();
      expect(health.releaseProbe).not.toHaveBeenCalled();
    });

    it("records success for a refusal: the host answered", async () => {
      fetchSpy.mockResolvedValueOnce(json({}, 403));
      await errorOf(provider.testCredentials(credentials));

      expect(health.recordSuccess).toHaveBeenCalledTimes(1);
      expect(health.recordFailure).not.toHaveBeenCalled();
      expect(health.logFailure).not.toHaveBeenCalled();
      expect(health.releaseProbe).not.toHaveBeenCalled();
    });

    describe("a transport failure", () => {
      const transportFailure = () =>
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("read ECONNRESET"), {
            code: "ECONNRESET",
          }),
        });

      it("is counted and logged once with its cause, and is not a success", async () => {
        const failure = transportFailure();
        fetchSpy.mockRejectedValueOnce(failure);

        const error = await errorOf(provider.testCredentials(credentials));

        expect(health.recordFailure).toHaveBeenCalledWith(
          "enable_banking",
          failure,
        );
        expect(health.logFailure).toHaveBeenCalledTimes(1);
        expect(health.logFailure).toHaveBeenCalledWith(
          expect.any(Logger),
          "enable_banking",
          "credentials check",
          failure,
        );
        expect(health.recordSuccess).not.toHaveBeenCalled();
        expect(error).toBeInstanceOf(BankSyncProviderError);
        expect(error).toMatchObject({ kind: "unavailable" });
        expect((error as Error).message).toContain("ECONNRESET");
      });

      it("hands back a probe slot the breaker did not count", async () => {
        health.assertAvailable.mockReturnValue("probe");
        health.recordFailure.mockReturnValue(false);
        fetchSpy.mockRejectedValueOnce(transportFailure());

        await errorOf(provider.testCredentials(credentials));

        expect(health.releaseProbe).toHaveBeenCalledWith("enable_banking");
      });

      it("keeps a probe slot the breaker did count", async () => {
        health.assertAvailable.mockReturnValue("probe");
        health.recordFailure.mockReturnValue(true);
        fetchSpy.mockRejectedValueOnce(transportFailure());

        await errorOf(provider.testCredentials(credentials));

        expect(health.releaseProbe).not.toHaveBeenCalled();
      });

      it("never releases a slot it does not hold", async () => {
        health.assertAvailable.mockReturnValue("open-gate");
        health.recordFailure.mockReturnValue(false);
        fetchSpy.mockRejectedValueOnce(transportFailure());

        await errorOf(provider.testCredentials(credentials));

        expect(health.releaseProbe).not.toHaveBeenCalled();
      });

      it("keeps the JWT out of the error, even if the transport error quotes it", async () => {
        fetchSpy.mockImplementationOnce(async (_input, init) => {
          const headers = init?.headers as Record<string, string>;
          throw Object.assign(new TypeError("fetch failed"), {
            cause: new Error(`bad header ${headers.Authorization}`),
          });
        });
        const error = (await errorOf(
          provider.testCredentials(credentials),
        )) as BankSyncProviderError;
        expect(error.message).not.toContain(tokenOf());
        expect(error.message).toContain("[redacted]");
      });
    });

    it("counts a body that stalls after the headers as a failure, not a success", async () => {
      const stalled = Object.assign(new TypeError("terminated"), {
        cause: Object.assign(new Error("Body Timeout Error"), {
          code: "UND_ERR_BODY_TIMEOUT",
        }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(stalled),
      } as unknown as Response);

      const error = await errorOf(provider.testCredentials(credentials));

      expect(health.recordFailure).toHaveBeenCalledWith(
        "enable_banking",
        stalled,
      );
      expect(health.logFailure).toHaveBeenCalledTimes(1);
      expect(health.recordSuccess).not.toHaveBeenCalled();
      expect(error).toMatchObject({ kind: "unavailable" });
    });

    it("reports an unparseable 2xx body as invalid_response and releases an uncounted probe", async () => {
      health.assertAvailable.mockReturnValue("probe");
      health.recordFailure.mockReturnValue(false);
      fetchSpy.mockResolvedValueOnce(new Response("<html>", { status: 200 }));

      const error = await errorOf(provider.testCredentials(credentials));

      expect(error).toMatchObject({ kind: "invalid_response" });
      expect(health.releaseProbe).toHaveBeenCalledWith("enable_banking");
      expect(health.recordSuccess).not.toHaveBeenCalled();
    });

    it("reports a refused call as unavailable without touching the host or logging", async () => {
      health.assertAvailable.mockImplementation(() => {
        throw new ProviderUnavailableError("Enable Banking", 60_000, "down");
      });

      const error = await errorOf(provider.testCredentials(credentials));

      expect(error).toBeInstanceOf(BankSyncProviderError);
      expect(error).toMatchObject({ kind: "unavailable" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(health.recordFailure).not.toHaveBeenCalled();
      expect(health.logFailure).not.toHaveBeenCalled();
      expect(health.recordSuccess).not.toHaveBeenCalled();
    });

    it("rethrows an unexpected error from the gate", async () => {
      health.assertAvailable.mockImplementation(() => {
        throw new Error("gate exploded");
      });
      await expect(provider.testCredentials(credentials)).rejects.toThrow(
        "gate exploded",
      );
    });

    it("refuses a key that cannot sign before the breaker or the host is touched", async () => {
      const error = await errorOf(
        provider.testCredentials({
          applicationId: APPLICATION_ID,
          privateKeyPem: "not a key",
        }),
      );

      expect(error).toMatchObject({ kind: "bad_request" });
      expect((error as Error).message).not.toContain("not a key");
      expect(health.assertAvailable).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
