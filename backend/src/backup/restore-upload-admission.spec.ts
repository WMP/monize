import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { createRestoreUploadAdmission } from "./restore-upload-admission";

const MIB = 1024 * 1024;

/**
 * A request carrying only what the middleware reads.
 *
 * Method and content-type default to what a real restore upload sends, because
 * the gate budgets exactly what the parser downstream will buffer -- see the
 * "requests the parser will not buffer" block for the other side of that.
 */
function request(
  headers: Record<string, string | string[]> = {},
  method = "POST",
) {
  return {
    method,
    headers: { "content-type": "application/gzip", ...headers },
  } as unknown as IncomingMessage;
}

/**
 * A response that records what was written and can emit `finish`/`close`, which
 * is how a reservation is released. Not a mock of the calls -- the property under
 * test is that the budget goes back down, and only the event does that.
 */
function response() {
  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  const res = Object.assign(emitter, {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      res.body = body;
    },
  }) as EventEmitter & {
    statusCode: number;
    setHeader: (n: string, v: string) => void;
    end: (b?: string) => void;
    body?: string;
  };
  return { res: res as unknown as ServerResponse, raw: res, headers };
}

describe("restore upload admission", () => {
  const LIMIT = 200 * MIB;

  it("admits an upload that fits the budget", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    const next = jest.fn();
    const { res, raw } = response();

    admission.middleware(
      request({ "content-length": String(150 * MIB) }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(raw.statusCode).toBe(200);
    expect(admission.reservedBytes()).toBe(150 * MIB);
  });

  /**
   * The defect this exists for (F3RRR-002). `express.raw` buffers before the JWT
   * guard and the throttler, so the per-request ceiling -- half the container --
   * is enforced twice over by two concurrent clients and the only replica is
   * OOM-killed. A refused request is the outcome; a dead process is not.
   */
  it("refuses a second concurrent upload the container cannot hold", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    const first = response();
    const second = response();
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      first.res,
      firstNext,
    );
    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      second.res,
      secondNext,
    );

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).not.toHaveBeenCalled();
    expect(second.raw.statusCode).toBe(503);
    // Told when to come back rather than left to guess -- this is a transient
    // refusal, unlike the 413.
    expect(second.headers["retry-after"]).toBe("30");
    expect(String(second.raw.body)).toContain("in progress");
  });

  it("admits the next upload once the first response finishes", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    const first = response();
    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      first.res,
      jest.fn(),
    );

    first.raw.emit("finish");
    expect(admission.reservedBytes()).toBe(0);

    const second = response();
    const secondNext = jest.fn();
    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      second.res,
      secondNext,
    );
    expect(secondNext).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation when the client disconnects mid-upload", () => {
    // A dropped connection emits `close` without `finish`. A reservation nothing
    // releases makes the budget shrink to zero over the process's lifetime, which
    // is a self-inflicted outage rather than a protection.
    const admission = createRestoreUploadAdmission(LIMIT);
    const { res, raw } = response();
    admission.middleware(
      request({ "content-length": String(100 * MIB) }),
      res,
      jest.fn(),
    );

    raw.emit("close");
    expect(admission.reservedBytes()).toBe(0);
  });

  it("releases once when both events fire", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    const { res, raw } = response();
    admission.middleware(
      request({ "content-length": String(100 * MIB) }),
      res,
      jest.fn(),
    );

    raw.emit("finish");
    raw.emit("close");
    // Not -100 MiB: a double release would let the budget grow past the
    // container, which is worse than not having one.
    expect(admission.reservedBytes()).toBe(0);
  });

  it("reserves the whole ceiling when the length is not declared", () => {
    // Chunked encoding does not say how much is coming, and the safe assumption
    // on a path reached before authentication is the most it is allowed to send.
    const admission = createRestoreUploadAdmission(LIMIT);
    const next = jest.fn();
    admission.middleware(request(), response().res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(admission.reservedBytes()).toBe(LIMIT);

    const second = response();
    const secondNext = jest.fn();
    admission.middleware(request(), second.res, secondNext);
    expect(secondNext).not.toHaveBeenCalled();
    expect(second.raw.statusCode).toBe(503);
  });

  it.each([
    ["a repeated header", "100,100"],
    ["a non-integer", "12.5"],
    ["a negative value", "-1"],
    ["something that is not a number", "lots"],
  ])("reserves the whole ceiling for %s", (_label, value) => {
    // Anything that is not a single non-negative integer is not a length this can
    // budget from, so it takes the conservative claim rather than a parse guess.
    const admission = createRestoreUploadAdmission(LIMIT);
    admission.middleware(
      request({ "content-length": value }),
      response().res,
      jest.fn(),
    );
    expect(admission.reservedBytes()).toBe(LIMIT);
  });

  it("refuses an over-large declared length without reserving for it", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    const next = jest.fn();
    const { res, raw, headers } = response();

    admission.middleware(
      request({ "content-length": String(LIMIT + 1) }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(raw.statusCode).toBe(413);
    // `express.raw` would refuse this too, but only after this had promised
    // memory on its behalf -- a rejected request must not occupy the budget.
    expect(admission.reservedBytes()).toBe(0);
    // Permanent for this body: retrying the same upload unchanged cannot work,
    // so there is no Retry-After to offer.
    expect(headers).not.toHaveProperty("retry-after");
  });

  it("keeps admitting after a refusal", () => {
    const admission = createRestoreUploadAdmission(LIMIT);
    admission.middleware(
      request({ "content-length": String(LIMIT + 1) }),
      response().res,
      jest.fn(),
    );

    const next = jest.fn();
    admission.middleware(
      request({ "content-length": String(10 * MIB) }),
      response().res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal so an operator can see the pressure", () => {
    const onRefusal = jest.fn();
    const admission = createRestoreUploadAdmission(LIMIT, LIMIT, onRefusal);
    admission.middleware(request(), response().res, jest.fn());
    admission.middleware(request(), response().res, jest.fn());

    expect(onRefusal).toHaveBeenCalledTimes(1);
    expect(String(onRefusal.mock.calls[0][0])).toContain("in progress");
  });

  it("admits several small uploads at once", () => {
    // The gate is a byte budget, not a mutex: three 10 MiB restores are not the
    // problem, and refusing them would make the fix worse than the defect.
    const admission = createRestoreUploadAdmission(LIMIT);
    for (let i = 0; i < 3; i += 1) {
      const next = jest.fn();
      admission.middleware(
        request({ "content-length": String(10 * MIB) }),
        response().res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(admission.reservedBytes()).toBe(30 * MIB);
  });

  /**
   * The gate must budget exactly what the parser allocates. A CORS preflight
   * carries no `Content-Length`, so without this it would claim the whole ceiling
   * for a request that buffers nothing -- turning the protection into a way to
   * deny the upload it protects.
   */
  describe("requests the parser will not buffer", () => {
    it.each([
      ["an OPTIONS preflight", "OPTIONS", "application/gzip"],
      ["a GET", "GET", "application/gzip"],
      ["a JSON POST", "POST", "application/json"],
    ])("passes %s through without reserving", (_label, method, contentType) => {
      const admission = createRestoreUploadAdmission(LIMIT);
      const next = jest.fn();
      admission.middleware(
        request({ "content-type": contentType }, method),
        response().res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(admission.reservedBytes()).toBe(0);
    });

    it("passes a request with no content-type through", () => {
      const admission = createRestoreUploadAdmission(LIMIT);
      const next = jest.fn();
      admission.middleware(
        { method: "POST", headers: {} } as unknown as IncomingMessage,
        response().res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(admission.reservedBytes()).toBe(0);
    });

    it("still reserves when the type carries parameters", () => {
      // "application/gzip; charset=binary" is the same media type, and a client
      // that adds a parameter must not slip past the budget.
      const admission = createRestoreUploadAdmission(LIMIT);
      admission.middleware(
        request({ "content-type": "application/gzip; charset=binary" }),
        response().res,
        jest.fn(),
      );
      expect(admission.reservedBytes()).toBe(LIMIT);
    });

    it("reserves for the encrypted envelope's type too", () => {
      // Encrypted backups upload as application/octet-stream, and the parser
      // buffers both -- a gate that covered only gzip would leave the larger of
      // the two paths unbudgeted.
      const admission = createRestoreUploadAdmission(LIMIT);
      admission.middleware(
        request({
          "content-type": "application/octet-stream",
          "content-length": String(50 * MIB),
        }),
        response().res,
        jest.fn(),
      );
      expect(admission.reservedBytes()).toBe(50 * MIB);
    });

    it("covers every type the parser is configured with (source guard)", () => {
      // The two lists are in different files, and a new accepted content type
      // added to main.ts without adding it here would be buffered unbudgeted.
      const main = fs.readFileSync(
        path.join(__dirname, "..", "main.ts"),
        "utf8",
      );
      const gate = fs.readFileSync(
        path.join(__dirname, "restore-upload-admission.ts"),
        "utf8",
      );
      const parserTypes =
        /express\.raw\(\{[\s\S]*?type:\s*\[([^\]]*)\]/.exec(main)?.[1] ?? "";
      const types = [...parserTypes.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) {
        expect(gate).toContain(`"${type}"`);
      }
    });
  });

  it("accepts a budget larger than one request", () => {
    // An operator with headroom can allow concurrency explicitly rather than
    // being held to one upload by a number they cannot reach.
    const admission = createRestoreUploadAdmission(LIMIT, 2 * LIMIT);
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      response().res,
      firstNext,
    );
    admission.middleware(
      request({ "content-length": String(190 * MIB) }),
      response().res,
      secondNext,
    );
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
  });
});

/**
 * The gate has to sit **before** the body parser, and the ordering is in
 * `main.ts`, which is excluded from coverage and has no test harness. So this is
 * a source guard: it is the whole point of the change, and getting it backwards
 * would leave the middleware running after the allocation it exists to prevent.
 */
describe("restore upload admission wiring", () => {
  it("registers admission ahead of express.raw", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "main.ts"),
      "utf8",
    );

    const admissionAt = source.indexOf("restoreAdmission.middleware");
    const parserAt = source.indexOf("express.raw({");
    expect(admissionAt).toBeGreaterThan(-1);
    expect(parserAt).toBeGreaterThan(-1);
    expect(admissionAt).toBeLessThan(parserAt);
  });
});
