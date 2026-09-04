import { ProviderHealthService } from "../../provider-health/provider-health.service";
import { AiPayeeContactLookupProvider } from "./ai-payee-contact-lookup.provider";
import { GooglePlacesLookupProvider } from "./google-places/google-places-lookup.provider";
import { PayeeLookupQuotaService } from "./google-places/payee-lookup-quota.service";
import { PayeeLookupSettingsService } from "./google-places/payee-lookup-settings.service";
import {
  ContactLookupUnavailableError,
  PayeeContactSuggestion,
} from "./payee-contact-lookup.types";
import { RoutingPayeeContactLookupProvider } from "./routing-payee-contact-lookup.provider";

const suggestionFrom = (
  source: PayeeContactSuggestion["source"],
): PayeeContactSuggestion => ({
  label: null,
  website: "https://acme.example",
  address: null,
  email: null,
  phone: null,
  source,
  confidence: null,
  notes: null,
  refined: [],
});

const placesAnswer = [suggestionFrom("google-places")];
const aiAnswer = [suggestionFrom("ai-web-search")];

/**
 * The routing matrix. Every row here is a decision a user can feel: which
 * service they pay for one lookup, and what they are told when neither can
 * answer.
 */
describe("RoutingPayeeContactLookupProvider", () => {
  let settings: { resolveSource: jest.Mock };
  let quota: { claim: jest.Mock };
  let places: { lookup: jest.Mock };
  let ai: { lookup: jest.Mock };
  let health: { wouldRefuse: jest.Mock };
  let router: RoutingPayeeContactLookupProvider;

  const userSource = {
    kind: "user" as const,
    apiKey: "key-1",
    userId: "user-1",
    capEnabled: true,
    cap: 1000,
  };
  const operatorSource = {
    kind: "operator" as const,
    apiKey: "operator-key",
    capEnabled: true,
    cap: 1000,
  };

  beforeEach(() => {
    settings = { resolveSource: jest.fn().mockResolvedValue(userSource) };
    quota = { claim: jest.fn().mockResolvedValue(1) };
    places = { lookup: jest.fn().mockResolvedValue(placesAnswer) };
    ai = { lookup: jest.fn().mockResolvedValue(aiAnswer) };
    health = { wouldRefuse: jest.fn().mockReturnValue(false) };
    router = new RoutingPayeeContactLookupProvider(
      settings as unknown as PayeeLookupSettingsService,
      quota as unknown as PayeeLookupQuotaService,
      places as unknown as GooglePlacesLookupProvider,
      ai as unknown as AiPayeeContactLookupProvider,
      health as unknown as ProviderHealthService,
    );
  });

  const lookup = () => router.lookup("user-1", { name: "Acme" });

  describe("with no Google Places key configured", () => {
    beforeEach(() =>
      settings.resolveSource.mockResolvedValue({ kind: "none" }),
    );

    it("answers through AI, exactly as before this feature existed", async () => {
      await expect(lookup()).resolves.toEqual(aiAnswer);
      expect(places.lookup).not.toHaveBeenCalled();
    });

    it("claims no quota for a lookup Places did not serve", async () => {
      await lookup();

      expect(quota.claim).not.toHaveBeenCalled();
    });
  });

  describe("with a key configured", () => {
    it("answers through Places and never asks AI", async () => {
      // Places REPLACES the AI lookup: paying an LLM beside a directory the
      // user configured is the thing this feature exists to stop.
      await expect(lookup()).resolves.toEqual(placesAnswer);
      expect(places.lookup).toHaveBeenCalledWith("key-1", { name: "Acme" });
      expect(ai.lookup).not.toHaveBeenCalled();
    });

    it("claims a request against the user's own counter first", async () => {
      await lookup();

      expect(quota.claim).toHaveBeenCalledWith(userSource);
      expect(quota.claim.mock.invocationCallOrder[0]).toBeLessThan(
        places.lookup.mock.invocationCallOrder[0],
      );
    });

    it("claims against the deployment's counter for the operator's key", async () => {
      settings.resolveSource.mockResolvedValue(operatorSource);

      await lookup();

      expect(quota.claim).toHaveBeenCalledWith(operatorSource);
      expect(places.lookup).toHaveBeenCalledWith("operator-key", {
        name: "Acme",
      });
    });

    it("answers through AI when the user switched Places off", async () => {
      settings.resolveSource.mockResolvedValue({ kind: "none" });

      await expect(lookup()).resolves.toEqual(aiAnswer);
    });
  });

  describe("when the monthly cap is spent", () => {
    beforeEach(() => quota.claim.mockResolvedValue(null));

    it("falls back to AI", async () => {
      // The cap is the user's own budget decision; stopping outright would
      // turn their limit into a broken feature.
      await expect(lookup()).resolves.toEqual(aiAnswer);
      expect(places.lookup).not.toHaveBeenCalled();
    });

    it("reports the cap, not a missing provider, when there is no AI either", async () => {
      // Two different repairs: wait out or raise the cap, versus configure a
      // provider the user may never have wanted.
      ai.lookup.mockRejectedValue(
        new ContactLookupUnavailableError("no_provider"),
      );

      await expect(lookup()).rejects.toMatchObject({
        reason: "quota_exceeded",
      });
    });

    it("passes an AI failure through as itself", async () => {
      const failure = new ContactLookupUnavailableError("failed", "relay down");
      ai.lookup.mockRejectedValue(failure);

      await expect(lookup()).rejects.toBe(failure);
    });
  });

  describe("when Google Places is failing", () => {
    it("reports the failure instead of quietly paying for AI", async () => {
      // A rejected key or a dead host is something the user or operator must
      // fix; absorbing it into an AI bill means they never find out.
      health.wouldRefuse.mockReturnValue(true);

      await expect(lookup()).rejects.toMatchObject({ reason: "failed" });
      expect(ai.lookup).not.toHaveBeenCalled();
    });

    it("spends no quota on a request the breaker would refuse", async () => {
      health.wouldRefuse.mockReturnValue(true);

      await expect(lookup()).rejects.toThrow();
      expect(quota.claim).not.toHaveBeenCalled();
    });

    it("lets a refusal from Google through without trying AI", async () => {
      places.lookup.mockRejectedValue(
        new ContactLookupUnavailableError("failed", "API key not valid"),
      );

      await expect(lookup()).rejects.toMatchObject({
        reason: "failed",
        detail: "API key not valid",
      });
      expect(ai.lookup).not.toHaveBeenCalled();
    });
  });
});
