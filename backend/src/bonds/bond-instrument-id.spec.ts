import {
  BOND_INSTRUMENT_NAMESPACE,
  bondInstrumentId,
  uuidV5,
} from "./bond-instrument-id";

describe("bond instrument id", () => {
  it("implements UUIDv5 (RFC 4122 DNS namespace vector)", () => {
    expect(
      uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
    ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is a pure function of the key, under the fixed namespace", () => {
    const id = bondInstrumentId("PL", "PL_MF", "TOS1029");
    expect(id).toBe(uuidV5("PL|PL_MF|TOS1029", BOND_INSTRUMENT_NAMESPACE));
    expect(id).toBe(bondInstrumentId("PL", "PL_MF", "TOS1029"));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("differs when any part of the key differs", () => {
    const ids = new Set([
      bondInstrumentId("PL", "PL_MF", "TOS1029"),
      bondInstrumentId("PL", "PL_MF", "TOS1030"),
      bondInstrumentId("DE", "PL_MF", "TOS1029"),
      bondInstrumentId("PL", "OTHER", "TOS1029"),
    ]);
    expect(ids.size).toBe(4);
  });

  it("pins the namespace", () => {
    expect(BOND_INSTRUMENT_NAMESPACE).toBe(
      "b2c1f3a4-6d5e-4f70-9a8b-1c2d3e4f5a6b",
    );
  });
});
