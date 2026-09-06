import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { MAP_PROVIDERS, UpdatePreferencesDto } from "./update-preferences.dto";
import { UserPreference } from "../entities/user-preference.entity";

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

async function mapProviderError(defaultMapProvider: string) {
  const dto = plainToInstance(UpdatePreferencesDto, { defaultMapProvider });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "defaultMapProvider");
}

describe("UpdatePreferencesDto map provider validation", () => {
  it.each([...MAP_PROVIDERS])("accepts %s", async (provider) => {
    expect(await mapProviderError(provider)).toBeUndefined();
  });

  it.each(["yandex", "Google", "", "openstreetmaps", "device "])(
    "rejects %s",
    async (provider) => {
      expect(await mapProviderError(provider)).toBeDefined();
    },
  );

  it("accepts an omitted provider, so an unrelated update need not send one", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {
      dateFormat: "YYYY-MM-DD",
    });
    const errors = await validate(dto);
    expect(
      errors.find((e) => e.property === "defaultMapProvider"),
    ).toBeUndefined();
  });

  it("lists exactly the values the entity column accepts", () => {
    // The entity writes its union out longhand so the varchar-capacity guard
    // can measure it, so the two lists are separate statements of one fact.
    // This is what stops them drifting -- and with them, the database CHECK.
    const fromEntity: UserPreference["defaultMapProvider"][] = [
      "device",
      "openstreetmap",
      "google",
      "apple",
      "bing",
      "waze",
    ];
    expect([...MAP_PROVIDERS].sort()).toEqual([...fromEntity].sort());
  });
});

describe("retired browser notification preference", () => {
  it.each([true, false])(
    "rejects the retired flag (%s) at the API boundary",
    async (value) => {
      const dto = plainToInstance(UpdatePreferencesDto, {
        notificationBrowser: value,
        notificationEmail: false,
      });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe("notificationBrowser");
      expect(errors[0].constraints).toHaveProperty("whitelistValidation");
    },
  );
});
