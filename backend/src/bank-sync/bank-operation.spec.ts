import type { EmailT } from "../i18n/email-translator";
import {
  NO_BANK_OPERATION,
  OPERATION_CODE_PATTERN,
  operationTagLabel,
  remittanceOperationCode,
  type BankOperation,
} from "./bank-operation";

const operation = (over: Partial<BankOperation> = {}): BankOperation => ({
  ...NO_BANK_OPERATION,
  ...over,
});

/** A translator that marks what it translated, so a label is seen to come from the catalogue. */
const polish: EmailT = (key, fallback) => `pl(${key})|${fallback}`;

describe("remittanceOperationCode", () => {
  it.each([
    ["CARD-PAYMENT", "CARD-PAYMENT"],
    ["TRANSFER-IN", "TRANSFER-IN"],
    [
      "MOBILE-PAYMENT-POS-NO-CARD-TX-CODE",
      "MOBILE-PAYMENT-POS-NO-CARD-TX-CODE",
    ],
    ["ATM-WITHDRAWAL", "ATM-WITHDRAWAL"],
    ["A1-B2", "A1-B2"],
  ])("reads a line that is a code: %s", (line, expected) => {
    expect(remittanceOperationCode([line])).toBe(expected);
  });

  it("reads the last whitespace-separated word of a line", () => {
    expect(remittanceOperationCode(["Zakupy 12.34 PLN CARD-PAYMENT"])).toBe(
      "CARD-PAYMENT",
    );
    expect(remittanceOperationCode(["  Zakupy   CARD-PAYMENT  "])).toBe(
      "CARD-PAYMENT",
    );
  });

  it("does not read a code that is not the last word, or not a code", () => {
    expect(remittanceOperationCode(["CARD-PAYMENT Zakupy"])).toBeNull();
    expect(remittanceOperationCode(["card-payment"])).toBeNull();
    expect(remittanceOperationCode(["CARDPAYMENT"])).toBeNull();
    expect(remittanceOperationCode(["-CARD-PAYMENT"])).toBeNull();
    expect(remittanceOperationCode(["CARD-"])).toBeNull();
    expect(remittanceOperationCode(["1CARD-PAYMENT"])).toBeNull();
    expect(remittanceOperationCode(["Zakupy"])).toBeNull();
    expect(remittanceOperationCode([])).toBeNull();
    expect(remittanceOperationCode(["", "   "])).toBeNull();
  });

  it("takes the first line that holds one", () => {
    expect(
      remittanceOperationCode(["Latte", "A CARD-PAYMENT", "B TRANSFER-IN"]),
    ).toBe("CARD-PAYMENT");
  });

  it("matches the pattern the spec names", () => {
    expect(OPERATION_CODE_PATTERN.source).toBe("^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$");
  });
});

describe("operationTagLabel", () => {
  it("is null when the bank named no operation", () => {
    expect(operationTagLabel(NO_BANK_OPERATION)).toBeNull();
    expect(
      operationTagLabel(operation({ code: "  ", description: "" })),
    ).toBeNull();
  });

  it.each([
    ["CARD-PAYMENT", "CARD-PAYMENT", "Card payment"],
    ["TRANSFER-IN", "TRANSFER-IN", "Incoming transfer"],
    ["TRANSFER-OUT", "TRANSFER-OUT", "Outgoing transfer"],
    ["MOBILE-PAYMENT-POS-NO-CARD-TX-CODE", "MOBILE-PAYMENT", "Mobile payment"],
    ["MOBILE-PAYMENT-ONLINE", "MOBILE-PAYMENT", "Mobile payment"],
    ["ATM-WITHDRAWAL", "ATM", "Cash withdrawal"],
    ["ATM-FOREIGN", "ATM", "Cash withdrawal"],
  ])("gives the known code %s its label", (code, key, label) => {
    expect(operationTagLabel(operation({ remittanceCode: code }))).toEqual({
      key,
      label,
    });
  });

  it("translates a known label through the recipient's translator, with the English as the fallback", () => {
    expect(
      operationTagLabel(operation({ remittanceCode: "CARD-PAYMENT" }), polish),
    ).toEqual({
      key: "CARD-PAYMENT",
      label: "pl(common.bankSync.operationTypes.cardPayment)|Card payment",
    });
    expect(
      operationTagLabel(operation({ remittanceCode: "ATM-X" }), polish)?.label,
    ).toBe("pl(common.bankSync.operationTypes.cashWithdrawal)|Cash withdrawal");
  });

  it("recognises a known code in any case", () => {
    expect(operationTagLabel(operation({ code: "card-payment" }))).toEqual({
      key: "CARD-PAYMENT",
      label: "Card payment",
    });
  });

  it("names an unknown code after itself, as the bank wrote it, and does not translate it", () => {
    expect(
      operationTagLabel(operation({ remittanceCode: "DIRECT-DEBIT" }), polish),
    ).toEqual({ key: "DIRECT-DEBIT", label: "DIRECT-DEBIT" });
    expect(operationTagLabel(operation({ code: "Standing Order" }))).toEqual({
      key: "Standing Order",
      label: "Standing Order",
    });
  });

  it("does not take MOBILE-PAYMENT or ATM without their suffix for the known families", () => {
    expect(operationTagLabel(operation({ code: "ATM" }))?.key).toBe("ATM");
    expect(operationTagLabel(operation({ code: "ATM" }))?.label).toBe("ATM");
    expect(
      operationTagLabel(operation({ code: "MOBILE-PAYMENT" }))?.label,
    ).toBe("MOBILE-PAYMENT");
  });

  it("prefers the remittance code, then the sub code, the code and the description", () => {
    const all = {
      remittanceCode: "CARD-PAYMENT",
      subCode: "TRANSFER-IN",
      code: "TRANSFER-OUT",
      description: "Other",
    };
    expect(operationTagLabel(operation(all))?.key).toBe("CARD-PAYMENT");
    expect(
      operationTagLabel(operation({ ...all, remittanceCode: null }))?.key,
    ).toBe("TRANSFER-IN");
    expect(
      operationTagLabel(
        operation({ ...all, remittanceCode: null, subCode: null }),
      )?.key,
    ).toBe("TRANSFER-OUT");
    expect(
      operationTagLabel(
        operation({
          ...all,
          remittanceCode: null,
          subCode: null,
          code: null,
        }),
      )?.key,
    ).toBe("Other");
  });

  it("makes no tag of text that is not plain, rather than a mangled one", () => {
    for (const hostile of [
      "<script>x</script>",
      "a\u0000b",
      "-leading",
      "x".repeat(101),
      "emoji \u{1F600}",
    ]) {
      expect(operationTagLabel(operation({ code: hostile }))).toBeNull();
    }
  });

  it("accepts a name of exactly the tag width", () => {
    const name = "a".repeat(100);
    expect(operationTagLabel(operation({ code: name }))).toEqual({
      key: name,
      label: name,
    });
  });
});
