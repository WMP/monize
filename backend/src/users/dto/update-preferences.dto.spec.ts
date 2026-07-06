import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdatePreferencesDto } from "./update-preferences.dto";

async function languageError(language: string) {
  const dto = plainToInstance(UpdatePreferencesDto, { language });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "language");
}

describe("UpdatePreferencesDto language validation", () => {
  it.each(["browser", "en", "fr", "pt-BR", "en-US", "en-GB"])(
    "accepts %s",
    async (language) => {
      expect(await languageError(language)).toBeUndefined();
    },
  );

  it.each(["EN", "english", "browserx", "e", "en_US", "en-gb"])(
    "rejects %s",
    async (language) => {
      expect(await languageError(language)).toBeDefined();
    },
  );
});

async function aiBubbleError(aiBubbleEnabled: unknown) {
  const dto = plainToInstance(UpdatePreferencesDto, { aiBubbleEnabled });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "aiBubbleEnabled");
}

describe("UpdatePreferencesDto aiBubbleEnabled validation", () => {
  it.each([true, false])("accepts %s", async (value) => {
    expect(await aiBubbleError(value)).toBeUndefined();
  });

  it("accepts an omitted value (optional)", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {});
    const errors = await validate(dto);
    expect(
      errors.find((e) => e.property === "aiBubbleEnabled"),
    ).toBeUndefined();
  });

  it.each(["yes", "true", 1, 0])("rejects %s", async (value) => {
    expect(await aiBubbleError(value)).toBeDefined();
  });
});

async function dashboardWidgetsError(dashboardWidgets: unknown) {
  const dto = plainToInstance(UpdatePreferencesDto, { dashboardWidgets });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "dashboardWidgets");
}

describe("UpdatePreferencesDto dashboardWidgets validation", () => {
  it("accepts an omitted value (optional)", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {});
    const errors = await validate(dto);
    expect(
      errors.find((e) => e.property === "dashboardWidgets"),
    ).toBeUndefined();
  });

  it("accepts an empty array", async () => {
    expect(await dashboardWidgetsError([])).toBeUndefined();
  });

  it("accepts a valid array of { id, visible }", async () => {
    expect(
      await dashboardWidgetsError([
        { id: "favourite-accounts", visible: true },
        { id: "upcoming-bills", visible: false },
      ]),
    ).toBeUndefined();
  });

  it("rejects a non-array value", async () => {
    expect(await dashboardWidgetsError("favourite-accounts")).toBeDefined();
  });

  it("rejects an entry with an invalid id (uppercase)", async () => {
    expect(
      await dashboardWidgetsError([
        { id: "Favourite_Accounts", visible: true },
      ]),
    ).toBeDefined();
  });

  it("rejects an entry with a non-boolean visible", async () => {
    expect(
      await dashboardWidgetsError([
        { id: "favourite-accounts", visible: "yes" },
      ]),
    ).toBeDefined();
  });

  it("rejects an entry missing visible", async () => {
    expect(
      await dashboardWidgetsError([{ id: "favourite-accounts" }]),
    ).toBeDefined();
  });

  it("rejects more than 50 entries", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `widget-${i}`,
      visible: true,
    }));
    expect(await dashboardWidgetsError(many)).toBeDefined();
  });
});
