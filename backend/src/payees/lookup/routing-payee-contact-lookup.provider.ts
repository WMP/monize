import { Injectable, Logger } from "@nestjs/common";
import { ProviderHealthService } from "../../provider-health/provider-health.service";
import { AiPayeeContactLookupProvider } from "./ai-payee-contact-lookup.provider";
import { GOOGLE_PLACES_PROVIDER } from "./google-places/google-places.client";
import { GooglePlacesLookupProvider } from "./google-places/google-places-lookup.provider";
import { PayeeLookupQuotaService } from "./google-places/payee-lookup-quota.service";
import {
  PayeeLookupSettingsService,
  ResolvedLookupSource,
} from "./google-places/payee-lookup-settings.service";
import {
  ContactLookupUnavailableError,
  PayeeContactLookupInput,
  PayeeContactLookupProvider,
  PayeeContactSuggestion,
} from "./payee-contact-lookup.types";

/**
 * Which source answers one lookup.
 *
 * The user picks the ORDER (`preferredSource`), and the rule is the same in
 * both directions: the second source is reached only when the first cannot
 * answer for a **configuration or budget** reason -- no AI provider
 * configured, or the Places cap spent -- and never to paper over a failure.
 *
 * By default Google Places goes first and REPLACES the AI adapter where it is
 * configured: it is cheaper per answer and returns directory facts rather than
 * a model's recollection. A user who chooses `ai` gets the mirror image, which
 * is what Google holding no email address makes worth offering.
 *
 * With Places first, AI is reached again in exactly one case: the month's
 * request cap is spent. That single fallback is deliberate, and so is its
 * narrowness:
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
    const {
      places: source,
      preferredSource,
      aiProviderConfigId,
    } = await this.settings.resolveRouting(userId);

    // The user asked for AI first. Places is still reached -- but only if AI
    // cannot answer for a CONFIGURATION reason, which is the same asymmetry the
    // other order uses: a source that fails is reported, never papered over by
    // paying the other one.
    if (preferredSource === "ai") {
      return this.aiFirst(userId, input, source, aiProviderConfigId);
    }

    if (source.kind === "none") {
      return this.ai.lookup(userId, input, aiProviderConfigId ?? undefined);
    }

    return this.viaPlaces(userId, input, source, aiProviderConfigId);
  }

  /**
   * AI first, with Places behind it.
   *
   * `no_provider` is the only reason to fall through: the user asked for a
   * model they have not configured, and Places can still answer. Anything else
   * the AI adapter raises -- a rejected key, a provider outage, an unreadable
   * answer -- is a failure the user has to see.
   */
  private async aiFirst(
    userId: string,
    input: PayeeContactLookupInput,
    source: ResolvedLookupSource,
    aiProviderConfigId: string | null,
  ): Promise<PayeeContactSuggestion[]> {
    try {
      return await this.ai.lookup(
        userId,
        input,
        aiProviderConfigId ?? undefined,
      );
    } catch (error) {
      const noProvider =
        error instanceof ContactLookupUnavailableError &&
        error.reason === "no_provider";
      if (!noProvider || source.kind === "none") throw error;
      this.logger.log(
        `No AI provider configured for user ${userId}; falling back to Google Places.`,
      );
      return this.viaPlaces(userId, input, source, aiProviderConfigId);
    }
  }

  /** One Places lookup: breaker pre-check, quota claim, request. */
  private async viaPlaces(
    userId: string,
    input: PayeeContactLookupInput,
    source: Exclude<ResolvedLookupSource, { kind: "none" }>,
    aiProviderConfigId: string | null,
  ): Promise<PayeeContactSuggestion[]> {
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
      return this.fallbackToAi(userId, input, aiProviderConfigId);
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
    aiProviderConfigId: string | null,
  ): Promise<PayeeContactSuggestion[]> {
    try {
      return await this.ai.lookup(
        userId,
        input,
        aiProviderConfigId ?? undefined,
      );
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
