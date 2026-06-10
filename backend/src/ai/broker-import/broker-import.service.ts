import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { AiService } from "../ai.service";
import { SecuritiesService } from "../../securities/securities.service";
import { InvestmentTransactionsService } from "../../securities/investment-transactions.service";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";
import { AccountsService } from "../../accounts/accounts.service";
import { AccountType } from "../../accounts/entities/account.entity";
import { BROKER_IMPORT_SYSTEM_PROMPT } from "../context/prompt-templates";
import { ParseBrokerImportDto } from "./dto/parse-broker-import.dto";
import { ApplyBrokerImportDto } from "./dto/apply-broker-import.dto";

// Defence-in-depth cap on the serialized LLM response, mirroring the other AI
// sub-modules. Broker dumps can be large but the structured output is small.
const MAX_JSON_SIZE = 200 * 1024;
// Hard cap on parsed orders so a runaway response cannot blow up downstream.
const MAX_ORDERS = 1000;

export type BrokerOrderSide = "BUY" | "SELL";

export interface ParsedBrokerOrder {
  rowId: string;
  securityName: string;
  exchange: string | null;
  side: BrokerOrderSide;
  quantity: number;
  price: number;
  value: number | null;
  commission: number;
  currency: string;
  tradeDate: string;
  matchedSecurityId: string | null;
  matchedSecurityName: string | null;
}

export interface BrokerImportParseResult {
  orders: ParsedBrokerOrder[];
  model: string;
  warnings: string[];
}

export interface BrokerImportApplyResult {
  created: number;
  securitiesCreated: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class BrokerImportService {
  private readonly logger = new Logger(BrokerImportService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly securitiesService: SecuritiesService,
    private readonly investmentTransactionsService: InvestmentTransactionsService,
    private readonly accountsService: AccountsService,
  ) {}

  async parse(
    userId: string,
    dto: ParseBrokerImportDto,
  ): Promise<BrokerImportParseResult> {
    const warnings: string[] = [];

    const tableText = this.htmlToTableText(dto.html);
    if (!tableText.trim()) {
      this.logger.warn(`Broker import parse: empty table text user=${userId}`);
      return {
        orders: [],
        model: "none",
        warnings: ["No tabular content found in the pasted HTML."],
      };
    }

    const response = await this.aiService.complete(
      userId,
      {
        systemPrompt: BROKER_IMPORT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract the executed buy/sell orders from this broker order history:\n\n${tableText}`,
          },
        ],
        maxTokens: 8192,
        temperature: 0.1,
        responseFormat: "json",
      },
      "broker-import",
    );

    const rawOrders = this.parseResponse(response.content, userId);

    // Load the user's securities once for fuzzy name matching.
    const securities = await this.securitiesService.findAll(userId, true);
    const securitiesByNormalizedName = new Map<
      string,
      { id: string; name: string }
    >();
    for (const sec of securities) {
      const key = this.normalizeName(sec.name);
      // Keep the first-seen security for a normalized name; duplicates are rare
      // and the first match is as good as any for a suggestion the user reviews.
      if (key && !securitiesByNormalizedName.has(key)) {
        securitiesByNormalizedName.set(key, { id: sec.id, name: sec.name });
      }
    }

    const orders: ParsedBrokerOrder[] = [];
    let index = 0;
    for (const raw of rawOrders) {
      const validated = this.validateOrder(raw);
      if (!validated) {
        warnings.push("Skipped an order with missing or invalid fields.");
        continue;
      }

      const normalized = this.normalizeName(validated.securityName);
      const match = normalized
        ? securitiesByNormalizedName.get(normalized)
        : undefined;

      orders.push({
        rowId: `order-${index}`,
        ...validated,
        matchedSecurityId: match?.id ?? null,
        matchedSecurityName: match?.name ?? null,
      });
      index += 1;
    }

    this.logger.log(
      `Broker import parse user=${userId} model=${response.model} ` +
        `rawOrders=${rawOrders.length} validOrders=${orders.length} ` +
        `matched=${orders.filter((o) => o.matchedSecurityId).length} ` +
        `warnings=${warnings.length}`,
    );

    return { orders, model: response.model, warnings };
  }

  async apply(
    userId: string,
    dto: ApplyBrokerImportDto,
  ): Promise<BrokerImportApplyResult> {
    // Validate the target account belongs to the user and can hold securities.
    const account = await this.accountsService.findOne(userId, dto.accountId);
    if (account.accountType !== AccountType.INVESTMENT) {
      throw new BadRequestException(
        "Target account must be an investment/brokerage account",
      );
    }

    let created = 0;
    let securitiesCreated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Dedupe newly-created securities by symbol within this batch so two orders
    // for the same new security create only one Security row.
    const createdSecurityIdBySymbol = new Map<string, string>();

    for (let i = 0; i < dto.orders.length; i += 1) {
      const order = dto.orders[i];
      try {
        const securityId = await this.resolveSecurityId(
          userId,
          order,
          createdSecurityIdBySymbol,
          () => {
            securitiesCreated += 1;
          },
        );

        await this.investmentTransactionsService.create(userId, {
          accountId: dto.accountId,
          action:
            order.side === "BUY" ? InvestmentAction.BUY : InvestmentAction.SELL,
          transactionDate: order.tradeDate,
          securityId,
          quantity: order.quantity,
          price: order.price,
          commission: order.commission,
        });
        created += 1;
      } catch (error) {
        skipped += 1;
        const message =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Order ${i + 1}: ${message}`);
        this.logger.warn(
          `Broker import apply: order ${i + 1} failed user=${userId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Broker import apply user=${userId} account=${dto.accountId} ` +
        `created=${created} securitiesCreated=${securitiesCreated} ` +
        `skipped=${skipped} errors=${errors.length}`,
    );

    return { created, securitiesCreated, skipped, errors };
  }

  /**
   * Resolve a concrete securityId for an apply order: either an existing
   * security (ownership validated via SecuritiesService.findOne) or a new one
   * created from `newSecurity`, deduped by symbol within the batch.
   */
  private async resolveSecurityId(
    userId: string,
    order: ApplyBrokerImportDto["orders"][number],
    createdSecurityIdBySymbol: Map<string, string>,
    onSecurityCreated: () => void,
  ): Promise<string> {
    if (order.securityId) {
      // Validates ownership; throws NotFoundException for unowned/missing ids.
      await this.securitiesService.findOne(userId, order.securityId);
      return order.securityId;
    }

    if (!order.newSecurity) {
      throw new BadRequestException(
        "Each order requires either securityId or newSecurity",
      );
    }

    const symbolKey = order.newSecurity.symbol.trim().toUpperCase();
    const existingInBatch = createdSecurityIdBySymbol.get(symbolKey);
    if (existingInBatch) {
      return existingInBatch;
    }

    const security = await this.securitiesService.create(userId, {
      symbol: order.newSecurity.symbol,
      name: order.newSecurity.name,
      exchange: order.newSecurity.exchange,
      currencyCode: order.newSecurity.currency,
      securityType: order.newSecurity.type,
    });
    createdSecurityIdBySymbol.set(symbolKey, security.id);
    onSecurityCreated();
    return security.id;
  }

  /**
   * Reduce raw broker HTML to plain table text. Drops scripts/styles, converts
   * cell and row boundaries to delimiters so a row's fields stay together, then
   * strips the remaining tags and decodes the common HTML entities. The result
   * is robust to messy markup -- the LLM does the final field extraction.
   */
  private htmlToTableText(html: string): string {
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");

    const withDelimiters = withoutScripts
      // Row boundaries -> newline.
      .replace(/<\/(tr|table|thead|tbody|div|p|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Cell boundaries -> tab so fields in a row stay separated.
      .replace(/<\/(td|th)>/gi, "\t");

    const withoutTags = withDelimiters.replace(/<[^>]+>/g, " ");

    const decoded = withoutTags
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

    return decoded
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  private parseResponse(content: string, userId: string): unknown[] {
    const trimmed = content.trim();
    const stripped = this.stripMarkdownFences(trimmed);

    let parsed: unknown = this.safeJsonParse(stripped);
    if (parsed === undefined) {
      const objectMatch = stripped.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        parsed = this.safeJsonParse(objectMatch[0]);
      }
    }
    if (parsed === undefined) {
      // Tolerate a bare array response.
      const arrayMatch = stripped.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        parsed = this.safeJsonParse(arrayMatch[0]);
      }
    }

    if (parsed === undefined || parsed === null) {
      this.logger.warn(
        `Broker import response was not valid JSON user=${userId} ` +
          `preview="${trimmed.slice(0, 300).replace(/\s+/g, " ")}"`,
      );
      return [];
    }

    if (JSON.stringify(parsed).length > MAX_JSON_SIZE) {
      this.logger.warn(
        `Broker import response too large user=${userId} limit=${MAX_JSON_SIZE}`,
      );
      return [];
    }

    const orders = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>).orders)
        ? ((parsed as Record<string, unknown>).orders as unknown[])
        : [];

    return orders.slice(0, MAX_ORDERS);
  }

  /**
   * Validate and clamp a single raw order from the LLM. Returns null when a
   * required field is missing or unusable so the caller can record a warning
   * and skip it.
   */
  private validateOrder(
    raw: unknown,
  ): Omit<
    ParsedBrokerOrder,
    "rowId" | "matchedSecurityId" | "matchedSecurityName"
  > | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;

    const securityName =
      typeof obj.securityName === "string" ? obj.securityName.trim() : "";
    if (!securityName) return null;

    const sideRaw = typeof obj.side === "string" ? obj.side.toUpperCase() : "";
    if (sideRaw !== "BUY" && sideRaw !== "SELL") return null;

    const quantity = this.toFiniteNumber(obj.quantity);
    if (quantity === null || quantity <= 0) return null;

    const price = this.toFiniteNumber(obj.price);
    if (price === null || price < 0) return null;

    const tradeDate =
      typeof obj.tradeDate === "string" ? obj.tradeDate.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;

    const valueNum = this.toFiniteNumber(obj.value);
    const commission = this.toFiniteNumber(obj.commission);
    const exchange =
      typeof obj.exchange === "string" && obj.exchange.trim()
        ? obj.exchange.trim().substring(0, 100)
        : null;
    const currency =
      typeof obj.currency === "string"
        ? obj.currency.trim().toUpperCase().substring(0, 10)
        : "";

    return {
      securityName: securityName.substring(0, 255),
      exchange,
      side: sideRaw as BrokerOrderSide,
      quantity: this.round(quantity, 8),
      price: this.round(price, 6),
      value:
        valueNum !== null && valueNum >= 0 ? this.round(valueNum, 4) : null,
      commission:
        commission !== null && commission >= 0 ? this.round(commission, 4) : 0,
      currency,
      tradeDate,
    };
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  private round(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Normalize a security name for fuzzy matching: lowercase, strip diacritics
   * (including Polish letters), drop punctuation, collapse whitespace. Mirrors
   * the payee organizer's normalization so behaviour is consistent.
   */
  private normalizeName(name: string): string {
    const lowered = name.toLowerCase();
    const deAccented = lowered
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/ą/g, "a")
      .replace(/ę/g, "e")
      .replace(/ó/g, "o")
      .replace(/ś/g, "s")
      .replace(/[żź]/g, "z")
      .replace(/ć/g, "c")
      .replace(/ń/g, "n");
    return deAccented
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private stripMarkdownFences(text: string): string {
    const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return text;
  }

  private safeJsonParse(text: string): unknown | undefined {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
