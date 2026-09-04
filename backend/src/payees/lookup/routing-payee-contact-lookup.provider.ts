import { Injectable, Logger } from "@nestjs/common";
import { ProviderHealthService } from "../../provider-health/provider-health.service";
import { AiPayeeContactLookupProvider } from "./ai-payee-contact-lookup.provider";
import { GOOGLE_PLACES_PROVIDER } from "./google-places/google-places.client";
import { GooglePlacesLookupProvider } from "./google-places/google-places-lookup.provider";
import { PayeeLookupQuotaService } from "./google-places/payee-lookup-quota.service";
import { PayeeLookupSettingsService } from "./google-places/payee-lookup-settings.service";
import {
  ContactLookupUnavailableError,
  PayeeContactLookupInput,
  PayeeContactLookupProvider,
  PayeeContactSuggestion,
} from "./payee-contact-lookup.types";

/**
 * Which source answers one lookup.
 *
 * Google Places REPLACES the AI adapter where it is configured -- it is what
 * the user chose and what they are paying Google for -- and AI is reached
 * again in exactly one case: the month's request cap is spent. That single
 * fallback is deliberate, and so is its narrowness:
 *
 * - **Cap reached** is a budget decision the user made, and silently stopping
 *   would turn their own limit into a broken feature. Falling back keeps
 *   lookups working at the cost they already accepted for AI.
 * - **A Places failure is NOT a fallback.** A rejected key, a project without
 *   the API enabled, an open breaker: each is something the user or the
 *   operator must fix, and quietly paying an LLM to paper over it means they
 *   never learn. It surfaces as `failed`, carrying Google's own message.
 *
 * The breaker is consulted with `wouldRefuse` -- the read-only predicate -- to
 * decide whether to *start*, so a known outage does not spend a quota slot on
 * a request that will be refused before it reaches a socket. The gate that
 * actually takes the slot is inside the client, as it must be.
 *
 * `AiService` is deliberately not injected here. The AI adapter already
 * answers `no_provider` when the user has configured no provider, so asking it
 * is how this class learns there is no fallback -- and injecting `AiService`
 * would put `PayeesModule` on `AiModule`'s require cycle, which is the reason
 * the AI adapter resolves it lazily in the first place.
 */
@Injectable()
export class RoutingPayeeContactLookupProvider implements PayeeContactLookupProvider {
  private readonly logger = new Logger(RoutingPayeeContactLookupProvider.name);

  constructor(
    private readonly settings: PayeeLookupSettingsService,
    private readonly quota: PayeeLookupQuotaService,
    private readonly places: GooglePlacesLookupProvider,
    private readonly ai: AiPayeeContactLookupProvider,
    private readonly health: ProviderHealthService,
  ) {}

  async lookup(
    userId: string,
    input: PayeeContactLookupInput,
  ): Promise<PayeeContactSuggestion[]> {
    const source = await this.settings.resolveSource(userId);
    if (source.kind === "none") {
      return this.ai.lookup(userId, input);
    }

    if (this.health.wouldRefuse(GOOGLE_PLACES_PROVIDER)) {
      throw new ContactLookupUnavailableError(
        "failed",
        "Google Places is not responding. Try again shortly.",
      );
    }

    const claimed = await this.quota.claim(source);
    if (claimed === null) {
      this.logger.log(
        `Google Places monthly limit reached for ${
          source.kind === "user" ? `user ${userId}` : "this deployment"
        }; falling back to the AI lookup.`,
      );
      return this.fallbackToAi(userId, input);
    }

    return this.places.lookup(source.apiKey, input);
  }

  /**
   * The cap is spent, so the AI adapter answers instead -- unless the user has
   * no AI provider, in which case there is nothing left to try and the reason
   * the user needs is the cap, not a missing provider they never configured.
   */
  private async fallbackToAi(
    userId: string,
    input: PayeeContactLookupInput,
  ): Promise<PayeeContactSuggestion[]> {
    try {
      return await this.ai.lookup(userId, input);
    } catch (error) {
      if (
        error instanceof ContactLookupUnavailableError &&
        error.reason === "no_provider"
      ) {
        throw new ContactLookupUnavailableError("quota_exceeded");
      }
      throw error;
    }
  }
}
