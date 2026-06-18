import { ConfigService } from "@nestjs/config";
import {
  ATTACHMENT_URL_TTL_MS,
  AttachmentSigningService,
} from "./attachment-signing.service";

describe("AttachmentSigningService", () => {
  const config = {
    get: (key: string) =>
      key === "JWT_SECRET" ? "test-secret-value" : undefined,
  } as unknown as ConfigService;
  const service = new AttachmentSigningService(config);

  const id = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";

  it("verifies a token it signed", () => {
    const token = service.sign(id, userId);
    expect(service.verify(id, userId, token)).toBe(true);
  });

  it("rejects a token for a different attachment or user", () => {
    const token = service.sign(id, userId);
    expect(
      service.verify("33333333-3333-3333-3333-333333333333", userId, token),
    ).toBe(false);
    expect(
      service.verify(id, "44444444-4444-4444-4444-444444444444", token),
    ).toBe(false);
  });

  it("rejects a tampered or malformed token", () => {
    const token = service.sign(id, userId);
    expect(service.verify(id, userId, token + "ff")).toBe(false);
    expect(service.verify(id, userId, "not-a-token")).toBe(false);
    expect(service.verify(id, userId, "")).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = 1_000_000;
    const token = service.sign(id, userId, now);
    const later = now + ATTACHMENT_URL_TTL_MS + 1;
    expect(service.verify(id, userId, token, later)).toBe(false);
    // Still valid just before expiry.
    expect(service.verify(id, userId, token, now + 1)).toBe(true);
  });
});
