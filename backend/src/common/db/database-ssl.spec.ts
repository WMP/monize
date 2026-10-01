import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDatabaseSsl } from "./database-ssl";

/** A `read` over a literal, the way a spec stands in for the environment. */
function env(values: Record<string, string>) {
  return (name: string): string | undefined => values[name];
}

describe("resolveDatabaseSsl", () => {
  it("is false unless DATABASE_SSL is exactly the string true", () => {
    expect(resolveDatabaseSsl(env({}))).toBe(false);
    expect(resolveDatabaseSsl(env({ DATABASE_SSL: "false" }))).toBe(false);
    expect(resolveDatabaseSsl(env({ DATABASE_SSL: "1" }))).toBe(false);
    expect(resolveDatabaseSsl(env({ DATABASE_SSL: "TRUE" }))).toBe(false);
  });

  it("does not read the CA file when SSL is off", () => {
    // DATABASE_SSL is the only switch: a CA path left in the environment of a
    // plain-TCP deployment must neither enable TLS nor be able to fail the boot.
    const readFile = jest.fn();

    const ssl = resolveDatabaseSsl(
      env({ DATABASE_SSL_CA_FILE: "/etc/ssl/db-ca.pem" }),
      readFile,
    );

    expect(ssl).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("verifies the server by default and carries no ca key", () => {
    const ssl = resolveDatabaseSsl(env({ DATABASE_SSL: "true" }));

    // toStrictEqual, so an explicit `ca: undefined` fails: the object is the
    // one the pool and the listener built before the CA variable existed.
    expect(ssl).toStrictEqual({ rejectUnauthorized: true });
    expect(Object.keys(ssl as object)).toEqual(["rejectUnauthorized"]);
  });

  it("skips verification only when DATABASE_SSL_REJECT_UNAUTHORIZED is exactly false", () => {
    expect(
      resolveDatabaseSsl(
        env({
          DATABASE_SSL: "true",
          DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
        }),
      ),
    ).toStrictEqual({ rejectUnauthorized: false });
    expect(
      resolveDatabaseSsl(
        env({ DATABASE_SSL: "true", DATABASE_SSL_REJECT_UNAUTHORIZED: "0" }),
      ),
    ).toStrictEqual({ rejectUnauthorized: true });
  });

  it("reads the CA file's contents into ca", () => {
    const pem =
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const readFile = jest.fn().mockReturnValue(pem);

    const ssl = resolveDatabaseSsl(
      env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: "/etc/ssl/db-ca.pem" }),
      readFile,
    );

    expect(readFile).toHaveBeenCalledWith("/etc/ssl/db-ca.pem");
    expect(ssl).toStrictEqual({ rejectUnauthorized: true, ca: pem });
  });

  it("keeps the CA alongside an explicit rejectUnauthorized=false", () => {
    const readFile = jest.fn().mockReturnValue("PEM");

    const ssl = resolveDatabaseSsl(
      env({
        DATABASE_SSL: "true",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
        DATABASE_SSL_CA_FILE: "/ca.pem",
      }),
      readFile,
    );

    expect(ssl).toStrictEqual({ rejectUnauthorized: false, ca: "PEM" });
  });

  it("trims the CA path, and treats a blank one as unset", () => {
    const readFile = jest.fn().mockReturnValue("PEM");

    expect(
      resolveDatabaseSsl(
        env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: "   \t " }),
        readFile,
      ),
    ).toStrictEqual({ rejectUnauthorized: true });
    expect(readFile).not.toHaveBeenCalled();

    resolveDatabaseSsl(
      env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: "  /ca.pem \n" }),
      readFile,
    );
    expect(readFile).toHaveBeenCalledWith("/ca.pem");
  });

  it("refuses the boot, naming the variable and the path, when the CA cannot be read", () => {
    const readFile = jest.fn().mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    const call = () =>
      resolveDatabaseSsl(
        env({
          DATABASE_SSL: "true",
          DATABASE_SSL_CA_FILE: "/etc/ssl/missing.pem",
        }),
        readFile,
      );

    expect(call).toThrow(/DATABASE_SSL_CA_FILE/);
    expect(call).toThrow(/\/etc\/ssl\/missing\.pem/);
    expect(call).toThrow(/ENOENT: no such file or directory/);
  });

  it("names the path when the read fails with something that is not an Error", () => {
    const readFile = jest.fn().mockImplementation(() => {
      throw "denied";
    });

    expect(() =>
      resolveDatabaseSsl(
        env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: "/ca.pem" }),
        readFile,
      ),
    ).toThrow(/DATABASE_SSL_CA_FILE.*\/ca\.pem.*denied/);
  });

  it("refuses an empty or whitespace-only CA file, naming the variable and the path", () => {
    for (const contents of ["", " \n\t\n"]) {
      const call = () =>
        resolveDatabaseSsl(
          env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: "/ca.pem" }),
          () => contents,
        );

      expect(call).toThrow(/DATABASE_SSL_CA_FILE/);
      expect(call).toThrow(/\/ca\.pem/);
      expect(call).toThrow(/empty/);
    }
  });

  it("never puts the database password in an error", () => {
    const call = () =>
      resolveDatabaseSsl(
        env({
          DATABASE_SSL: "true",
          DATABASE_SSL_CA_FILE: "/ca.pem",
          DATABASE_PASSWORD: "s3cret-pw",
          DATABASE_APP_PASSWORD: "s3cret-app-pw",
        }),
        () => {
          throw new Error("EACCES");
        },
      );

    expect(call).not.toThrow(/s3cret/);
  });

  it("reads the real file when no reader is injected", () => {
    // The default reader is what db-init, db-migrate and the pool actually use.
    const dir = mkdtempSync(join(tmpdir(), "database-ssl-"));
    try {
      const file = join(dir, "ca.pem");
      writeFileSync(file, "REAL PEM");

      expect(
        resolveDatabaseSsl(
          env({ DATABASE_SSL: "true", DATABASE_SSL_CA_FILE: file }),
        ),
      ).toStrictEqual({ rejectUnauthorized: true, ca: "REAL PEM" });
      expect(() =>
        resolveDatabaseSsl(
          env({
            DATABASE_SSL: "true",
            DATABASE_SSL_CA_FILE: join(dir, "absent.pem"),
          }),
        ),
      ).toThrow(/DATABASE_SSL_CA_FILE.*absent\.pem/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
