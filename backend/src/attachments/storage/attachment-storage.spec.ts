import { ConfigService } from "@nestjs/config";
import {
  DbAttachmentStorage,
  attachmentStorageFactory,
} from "./attachment-storage";
import { Attachment } from "../entities/attachment.entity";

describe("DbAttachmentStorage", () => {
  const storage = new DbAttachmentStorage();

  it("stores bytes inline and reports no external key", async () => {
    const data = Buffer.from("hello");
    const result = await storage.save("id", data);
    expect(result.inlineData).toBe(data);
    expect(result.storageKey).toBeNull();
  });

  it("loads inline bytes back", async () => {
    const data = Buffer.from("bytes");
    const attachment = { id: "a", data } as Attachment;
    await expect(storage.load(attachment)).resolves.toBe(data);
  });

  it("throws when inline bytes are missing", async () => {
    const attachment = { id: "a", data: null } as Attachment;
    await expect(storage.load(attachment)).rejects.toThrow(/no inline data/i);
  });
});

describe("attachmentStorageFactory", () => {
  const make = (driver?: string): ConfigService =>
    ({ get: () => driver }) as unknown as ConfigService;

  it("defaults to the db driver", () => {
    expect(attachmentStorageFactory(make(undefined)).driver).toBe("db");
    expect(attachmentStorageFactory(make("db")).driver).toBe("db");
  });

  it("falls back to db for not-yet-implemented or unknown drivers", () => {
    expect(attachmentStorageFactory(make("local")).driver).toBe("db");
    expect(attachmentStorageFactory(make("s3")).driver).toBe("db");
    expect(attachmentStorageFactory(make("bogus")).driver).toBe("db");
  });
});
