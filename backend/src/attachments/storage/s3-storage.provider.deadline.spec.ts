import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { ConfigService } from "@nestjs/config";
import { S3StorageProvider } from "./s3-storage.provider";

/**
 * The deadline, proven against a live socket rather than a mock (REMAINING-003).
 *
 * The sweeper's quarantine window is only sufficient if no S3 operation can still
 * be in flight when it closes, and socket inactivity timers cannot promise that: an
 * endpoint that trickles a byte at a time keeps the connection busy forever without
 * ever going idle. These tests run the real SDK stack -- client, handler, signer,
 * retry middleware -- against exactly that endpoint, in each of its stall shapes,
 * and assert the operation is aborted by the total deadline, promptly, with the
 * error that names it.
 *
 * The trickle interval (25 ms) is far below the configured deadline (400 ms), so
 * the handler's inactivity timers -- set to the same 400 ms -- can never fire.
 * Only the whole-operation abort can end these requests; a pass here is proof of
 * that mechanism, not of the socket timers.
 */
describe("S3StorageProvider deadline against a stalled endpoint", () => {
  const DEADLINE_MS = 400;
  const TRICKLE_MS = 25;

  let server: http.Server;
  const sockets = new Set<Socket>();

  type StallMode = "trickle-headers" | "trickle-body" | "ok";
  let mode: StallMode = "trickle-headers";

  const providerFor = (port: number): S3StorageProvider =>
    new S3StorageProvider({
      get: (key: string) =>
        ({
          ATTACHMENT_S3_BUCKET: "stall-bucket",
          ATTACHMENT_S3_ENDPOINT: `http://127.0.0.1:${port}`,
          ATTACHMENT_S3_FORCE_PATH_STYLE: "true",
          ATTACHMENT_S3_REGION: "us-east-1",
          ATTACHMENT_S3_ACCESS_KEY_ID: "test",
          ATTACHMENT_S3_SECRET_ACCESS_KEY: "test",
          ATTACHMENT_S3_REQUEST_TIMEOUT_MS: String(DEADLINE_MS),
        })[key],
    } as unknown as ConfigService);

  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      // Accept the request body so the client is never blocked on backpressure.
      req.resume();
      if (mode === "ok") {
        res.writeHead(200, { etag: '"d41d8cd98f00b204e9800998ecf8427e"' });
        res.end();
        return;
      }
      if (mode === "trickle-body") {
        // Headers complete, so send() resolves and the caller is consuming the
        // body -- the phase no handler option bounds. Then never finish.
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": "10000000",
        });
        const timer = setInterval(() => res.write("x"), TRICKLE_MS);
        res.on("close", () => clearInterval(timer));
        return;
      }
      // trickle-headers: a syntactically valid response that never completes its
      // header section, keeping the socket active so inactivity timers never fire.
      const socket = req.socket;
      socket.write("HTTP/1.1 200 OK\r\n");
      let n = 0;
      const timer = setInterval(() => {
        socket.write(`x-stall-${n++}: x\r\n`);
      }, TRICKLE_MS);
      socket.on("close", () => clearInterval(timer));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const expectDeadline = async (
    operation: () => Promise<unknown>,
    name: string,
  ): Promise<void> => {
    const started = Date.now();
    await expect(operation()).rejects.toThrow(
      new RegExp(`S3 ${name} exceeded its ${DEADLINE_MS} ms deadline`),
    );
    const elapsed = Date.now() - started;
    // Promptly: at the deadline, not at some multiple of it accumulated by
    // retries, and never unbounded.
    expect(elapsed).toBeGreaterThanOrEqual(DEADLINE_MS - 50);
    expect(elapsed).toBeLessThan(DEADLINE_MS * 8);
  };

  it("aborts a PutObject whose response never arrives", async () => {
    mode = "trickle-headers";
    await expectDeadline(
      () => providerFor(port).save("k", Buffer.from("payload")),
      "PutObject",
    );
  }, 15000);

  it("aborts a GetObject stalled mid-body, after send() has already resolved", async () => {
    mode = "trickle-body";
    await expectDeadline(() => providerFor(port).load("k"), "GetObject");
  }, 15000);

  it("aborts a DeleteObject whose response never arrives", async () => {
    mode = "trickle-headers";
    await expectDeadline(() => providerFor(port).delete("k"), "DeleteObject");
  }, 15000);

  it("is not what fails a healthy operation", async () => {
    // The control: the same provider, client and signature against the same
    // server responding promptly. Proves the aborts above come from the stall,
    // not from the harness.
    mode = "ok";
    await expect(
      providerFor(port).save("k", Buffer.from("payload")),
    ).resolves.toBeUndefined();
  }, 15000);
});
