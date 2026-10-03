import {
  effectiveReceiptDate,
  resolveForwardedIdentity,
  sameIdentity,
  type ReceiptIdentity,
} from "./forwarded-receipt";

const FORWARD = [
  "Please look at this order.",
  "",
  "---------- Forwarded message ---------",
  "From: Example Shop <Orders@Shop.Example.COM>",
  "Date: Mon, Aug 31, 2026 at 10:15 AM",
  "Subject: Order #A-1001 confirmed",
  "To: <alice.example@example.com>",
  "",
  "Order total: 49.99",
].join("\n");

const FORWARDER: ReceiptIdentity = {
  fromAddress: "alice.example@gmail.example.com",
  fromDomain: "gmail.example.com",
  subject: "Fwd: Order #A-1001 confirmed",
  forwardedBy: null,
  originalSentAt: null,
};
const RECEIVED = new Date("2026-10-01T09:00:00Z");

describe("resolveForwardedIdentity", () => {
  it("replaces the forwarder with the shop and keeps the forwarder as forwardedBy", () => {
    expect(resolveForwardedIdentity(FORWARDER, FORWARD, RECEIVED)).toEqual({
      fromAddress: "orders@shop.example.com",
      fromDomain: "shop.example.com",
      subject: "Order #A-1001 confirmed",
      forwardedBy: "alice.example@gmail.example.com",
      originalSentAt: new Date("2026-08-31T10:15:00.000Z"),
    });
  });

  it("is null for an email that is not a forward: nothing changes", () => {
    expect(
      resolveForwardedIdentity(FORWARDER, "Order total: 49.99", RECEIVED),
    ).toBeNull();
  });

  it("keeps the forwarder's own subject when the block has none", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Shop <orders@shop.example.com>",
      "Date: Mon, Aug 31, 2026 at 10:15 AM",
    ].join("\n");

    expect(resolveForwardedIdentity(FORWARDER, text, RECEIVED)?.subject).toBe(
      "Fwd: Order #A-1001 confirmed",
    );
  });

  it("is idempotent: a healed row heals to itself and keeps the original forwarder", () => {
    const first = resolveForwardedIdentity(FORWARDER, FORWARD, RECEIVED);
    expect(first).not.toBeNull();
    const second = resolveForwardedIdentity(
      first as ReceiptIdentity,
      FORWARD,
      RECEIVED,
    );

    expect(second).toEqual(first);
    expect(
      sameIdentity(first as ReceiptIdentity, second as ReceiptIdentity),
    ).toBe(true);
    expect(second?.forwardedBy).toBe("alice.example@gmail.example.com");
  });

  it("drops an original date later than the day the forward arrived", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Shop <orders@shop.example.com>",
      "Date: Mon, Dec 7, 2026 at 10:15 AM",
      "Subject: Order",
    ].join("\n");

    const resolved = resolveForwardedIdentity(FORWARDER, text, RECEIVED);

    expect(resolved?.fromAddress).toBe("orders@shop.example.com");
    expect(resolved?.originalSentAt).toBeNull();
  });

  it("keeps a date up to a day after the arrival (a clock a little ahead)", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Shop <orders@shop.example.com>",
      "Date: Thu, Oct 1, 2026 at 11:00 PM",
      "Subject: Order",
    ].join("\n");

    expect(
      resolveForwardedIdentity(FORWARDER, text, RECEIVED)?.originalSentAt,
    ).toEqual(new Date("2026-10-01T23:00:00.000Z"));
  });

  it("bounds the stored values to their columns", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Shop <orders@shop.example.com>",
      `Subject: ${"word ".repeat(300)}`,
    ].join("\n");

    const resolved = resolveForwardedIdentity(FORWARDER, text, RECEIVED);

    expect(resolved?.subject.length).toBeLessThanOrEqual(500);
    expect(resolved?.subject).not.toMatch(/\s{2}/);
  });
});

describe("sameIdentity", () => {
  it("compares every identity column, dates by instant", () => {
    const a: ReceiptIdentity = {
      ...FORWARDER,
      originalSentAt: new Date("2026-08-31T10:15:00Z"),
    };

    expect(
      sameIdentity(a, {
        ...a,
        originalSentAt: new Date(a.originalSentAt as Date),
      }),
    ).toBe(true);
    expect(sameIdentity(a, { ...a, originalSentAt: null })).toBe(false);
    expect(sameIdentity(a, { ...a, subject: "x" })).toBe(false);
    expect(sameIdentity(a, { ...a, fromAddress: "x@y.example" })).toBe(false);
    expect(sameIdentity(a, { ...a, fromDomain: "y.example" })).toBe(false);
    expect(sameIdentity(a, { ...a, forwardedBy: "z@y.example" })).toBe(false);
  });
});

describe("effectiveReceiptDate", () => {
  const receivedAt = new Date("2026-10-01T09:00:00Z");

  it("is the shop's day when a forward carried it", () => {
    const originalSentAt = new Date("2026-08-31T10:15:00Z");
    expect(effectiveReceiptDate({ originalSentAt, receivedAt })).toBe(
      originalSentAt,
    );
  });

  it("is the arrival day otherwise", () => {
    expect(effectiveReceiptDate({ originalSentAt: null, receivedAt })).toBe(
      receivedAt,
    );
  });
});
