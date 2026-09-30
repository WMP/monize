import { describeMailboxFailure, mailboxSecrets } from "./mailbox-failure.util";

describe("describeMailboxFailure (INV-RECEIPT-005)", () => {
  const PASSWORD = "hunter2-very-secret";

  it("never contains the password, however the error quotes it", () => {
    const error = Object.assign(
      new Error(`Command failed: LOGIN user ${PASSWORD}`),
      {
        authenticationFailed: true,
        responseText: `A1 NO invalid credentials for ${PASSWORD}`,
        cause: new Error(`inner ${PASSWORD}`),
      },
    );

    const line = describeMailboxFailure(
      error,
      mailboxSecrets("user", PASSWORD),
    );

    expect(line).not.toContain(PASSWORD);
    expect(line).toContain("authentication failed");
    expect(line).toContain("***");
  });

  it("removes the SASL PLAIN blob a server might echo", () => {
    const blob = Buffer.from(`\u0000user\u0000${PASSWORD}`).toString("base64");
    const line = describeMailboxFailure(
      new Error(`AUTHENTICATE PLAIN ${blob}`),
      mailboxSecrets("user", PASSWORD),
    );

    expect(line).not.toContain(blob);
    expect(line).not.toContain(PASSWORD);
  });

  it("is at most 300 characters and one line", () => {
    const line = describeMailboxFailure(
      new Error(`first line\n${"very long ".repeat(200)}\u0000end`),
    );

    expect(line.length).toBeLessThanOrEqual(300);
    for (const dropped of ["\n", "\r", "\u0000"]) {
      expect(line.includes(dropped)).toBe(false);
    }
  });

  it("names the socket-level cause and bounds the server's own text", () => {
    const error = Object.assign(new Error("Command failed"), {
      code: "ECONNREFUSED",
      serverResponseCode: "AUTHENTICATIONFAILED",
      responseText: "x".repeat(500),
    });

    const line = describeMailboxFailure(error);

    expect(line).toContain("code=ECONNREFUSED");
    expect(line).toContain("server code AUTHENTICATIONFAILED");
    expect(line.length).toBeLessThanOrEqual(300);
  });

  it("explains a refused private address in words", () => {
    const refused = Object.assign(new Error("Refusing a connection"), {
      code: "AI_EGRESS_REFUSED",
    });

    expect(describeMailboxFailure(refused)).toContain(
      "the host resolves to a private address",
    );
  });

  it("answers for a thrown non-error", () => {
    expect(describeMailboxFailure("boom")).toContain("boom");
    expect(describeMailboxFailure(undefined)).toBe("unknown error");
  });

  it("does not mask text when there is no secret, and ignores an empty one", () => {
    const line = describeMailboxFailure(new Error("plain failure"), [""]);
    expect(line).toBe("plain failure");
    expect(mailboxSecrets("user", "")).toEqual([
      Buffer.from("\u0000user\u0000").toString("base64"),
    ]);
  });
});
