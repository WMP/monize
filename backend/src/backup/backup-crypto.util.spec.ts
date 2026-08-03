import { readFileSync } from "fs";
import { join } from "path";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  BackupDecryptionError,
} from "./backup-crypto.util";

describe("backup-crypto.util", () => {
  const payload = Buffer.from(
    JSON.stringify({ version: 1, accounts: [{ id: "a" }] }),
    "utf-8",
  );

  describe("isEncryptedBackup", () => {
    it("returns false for plain gzip-shaped bytes", () => {
      // gzip magic: 1f 8b
      expect(isEncryptedBackup(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(
        false,
      );
    });

    it("returns false for empty buffer", () => {
      expect(isEncryptedBackup(Buffer.alloc(0))).toBe(false);
    });

    it("returns true for an encrypted envelope", async () => {
      const ct = await encryptBackup(payload, "correct horse battery staple");
      expect(isEncryptedBackup(ct)).toBe(true);
    });
  });

  describe("encrypt/decrypt round-trip", () => {
    it("decrypts back to the original payload with the right password", async () => {
      const password = "correct horse battery staple";
      const ct = await encryptBackup(payload, password);
      const pt = await decryptBackup(ct, password);
      expect(pt.equals(payload)).toBe(true);
    });

    it("produces different ciphertexts each call (random salt+iv)", async () => {
      const password = "same-password";
      const a = await encryptBackup(payload, password);
      const b = await encryptBackup(payload, password);
      expect(a.equals(b)).toBe(false);
    });

    it("throws BackupDecryptionError on wrong password", async () => {
      const ct = await encryptBackup(payload, "right");
      await expect(decryptBackup(ct, "wrong")).rejects.toThrow(
        BackupDecryptionError,
      );
    });

    it("throws BackupDecryptionError on tampered ciphertext", async () => {
      const ct = await encryptBackup(payload, "p");
      ct[ct.length - 1] ^= 0xff;
      await expect(decryptBackup(ct, "p")).rejects.toThrow(
        BackupDecryptionError,
      );
    });

    it("throws on input lacking magic header", async () => {
      const notEncrypted = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0]);
      await expect(decryptBackup(notEncrypted, "p")).rejects.toThrow(
        BackupDecryptionError,
      );
    });

    it("requires a non-empty password to encrypt", async () => {
      await expect(encryptBackup(payload, "")).rejects.toThrow();
    });

    it("throws on an unsupported KDF byte", async () => {
      const ct = await encryptBackup(payload, "p");
      // Flip the KDF byte (index 5) to an unsupported value.
      ct[5] = 0x99;
      await expect(decryptBackup(ct, "p")).rejects.toThrow(
        /Unsupported key derivation function/,
      );
    });
  });

  describe("key derivation stays off the event loop", () => {
    it("uses the async scrypt, not scryptSync", () => {
      // Comments stripped: this file's own prose explains why `scryptSync` was
      // wrong, and a marker test against the raw text would match that
      // explanation and fail forever.
      const source = readFileSync(
        join(__dirname, "backup-crypto.util.ts"),
        "utf-8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      // scrypt at N=32768 is ~100ms of CPU, and maybeDecrypt tries up to three
      // candidate passwords per restore. On the event loop that stalled every
      // other request in the process for a third of a second, from one
      // authenticated caller -- the same failure the async gunzip fixed.
      expect(source).not.toMatch(/scryptSync/);
      expect(source).toMatch(/promisify\(crypto\.scrypt\)/);
    });
  });
});
