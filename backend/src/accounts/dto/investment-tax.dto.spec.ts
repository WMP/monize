import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateAccountDto } from "./create-account.dto";
import { UpdateAccountDto } from "./update-account.dto";

/**
 * Field-level validation of the simplified tax-estimation settings. The
 * cross-field rules ("a percentage mode needs a rate", "these settings only
 * exist on accounts that hold securities") live in AccountsService, because
 * they depend on the stored account; what a DTO can enforce on its own is the
 * mode vocabulary and the 0-100 rate bound.
 */
function create(partial: Record<string, unknown> = {}): CreateAccountDto {
  return plainToInstance(CreateAccountDto, {
    name: "Brokerage",
    accountType: "INVESTMENT",
    currencyCode: "PLN",
    ...partial,
  });
}

async function failures(instance: object): Promise<string[]> {
  const errors = await validate(instance);
  return errors.map((error) => error.property).sort();
}

describe("capital gains tax settings", () => {
  it.each(["none", "percentage_of_profit", "percentage_of_sale_value"])(
    "accepts the %s mode",
    async (mode) => {
      expect(
        await failures(
          create({ capitalGainsTaxMode: mode, capitalGainsTaxRate: 19 }),
        ),
      ).toEqual([]);
    },
  );

  it("rejects an unknown mode", async () => {
    expect(
      await failures(create({ capitalGainsTaxMode: "percentage_of_vibes" })),
    ).toEqual(["capitalGainsTaxMode"]);
  });

  it.each([0, 0.5, 19, 26.375, 100])("accepts a rate of %s%%", async (rate) => {
    expect(await failures(create({ capitalGainsTaxRate: rate }))).toEqual([]);
  });

  it("rejects a negative rate", async () => {
    expect(await failures(create({ capitalGainsTaxRate: -1 }))).toEqual([
      "capitalGainsTaxRate",
    ]);
  });

  it("rejects a rate above 100%", async () => {
    expect(await failures(create({ capitalGainsTaxRate: 100.01 }))).toEqual([
      "capitalGainsTaxRate",
    ]);
  });

  it("rejects a rate with more than four decimals", async () => {
    expect(await failures(create({ capitalGainsTaxRate: 19.123456 }))).toEqual([
      "capitalGainsTaxRate",
    ]);
  });
});

describe("dividend tax settings", () => {
  it.each(["none", "percentage_of_gross_dividend"])(
    "accepts the %s mode",
    async (mode) => {
      expect(
        await failures(create({ dividendTaxMode: mode, dividendTaxRate: 19 })),
      ).toEqual([]);
    },
  );

  it("rejects an unknown mode", async () => {
    expect(await failures(create({ dividendTaxMode: "percentage_of_net" }))).toEqual(
      ["dividendTaxMode"],
    );
  });

  it.each([
    ["dividendTaxRate", -0.01],
    ["dividendTaxRate", 100.5],
    ["dividendWithholdingTaxRate", -5],
    ["dividendWithholdingTaxRate", 101],
  ])("rejects %s out of the 0-100 range (%s)", async (field, rate) => {
    expect(await failures(create({ [field]: rate }))).toEqual([field]);
  });

  it.each([
    ["dividendTaxRate", 0],
    ["dividendTaxRate", 100],
    ["dividendWithholdingTaxRate", 15],
  ])("accepts %s at %s%%", async (field, rate) => {
    expect(await failures(create({ [field]: rate }))).toEqual([]);
  });

  it("rejects a non-boolean deduct flag", async () => {
    expect(
      await failures(create({ deductRecordedWithholdingTax: "yes" })),
    ).toEqual(["deductRecordedWithholdingTax"]);
  });
});

describe("clearing a rate on update", () => {
  it.each([
    "capitalGainsTaxRate",
    "dividendTaxRate",
    "dividendWithholdingTaxRate",
  ])("accepts null for %s", async (field) => {
    const dto = plainToInstance(UpdateAccountDto, { [field]: null });
    expect(await failures(dto)).toEqual([]);
  });

  it.each([
    "capitalGainsTaxRate",
    "dividendTaxRate",
    "dividendWithholdingTaxRate",
  ])("still enforces the 0-100 range on %s", async (field) => {
    const dto = plainToInstance(UpdateAccountDto, { [field]: 250 });
    expect(await failures(dto)).toEqual([field]);
  });
});
