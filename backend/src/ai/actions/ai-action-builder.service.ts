import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  AiActionSigningService,
  AI_ACTION_TTL_MS,
} from "./ai-action-signing.service";
import {
  AiActionPreviewRow,
  CategorizeTransactionDescriptor,
  CreateInvestmentTransactionDescriptor,
  CreateInvestmentTransactionsDescriptor,
  CreatePayeeDescriptor,
  CreateSecurityDescriptor,
  CreateTransactionDescriptor,
  CreateTransactionsDescriptor,
  PendingAiAction,
} from "./ai-action.types";
import {
  CategorizeTransactionPreview,
  CreateTransactionPreview,
} from "../../transactions/transactions.service";
import { CreatePayeePreview } from "../../payees/payees.service";
import { CreateInvestmentTransactionPreview } from "../../securities/investment-transactions.service";
import { CreateSecurityPreview } from "../../securities/securities.service";

/**
 * Map a resolved cash-transaction preview to the display row shown on the bulk
 * confirmation card. Shared by the AI Assistant tool executor and the MCP bulk
 * tool so the two surfaces present identical rows.
 */
export function transactionPreviewRow(
  preview: CreateTransactionPreview,
): AiActionPreviewRow {
  return {
    status: "ok",
    accountName: preview.accountName,
    amount: preview.amount,
    currencyCode: preview.currencyCode,
    transactionDate: preview.transactionDate,
    payeeName: preview.payeeName,
    payeeWillBeCreated: preview.payeeWillBeCreated,
    categoryName: preview.categoryName,
    description: preview.description,
  };
}

/** Map a resolved investment-transaction preview to a bulk-card display row. */
export function investmentPreviewRow(
  preview: CreateInvestmentTransactionPreview,
): AiActionPreviewRow {
  return {
    status: "ok",
    accountName: preview.accountName,
    investmentAction: preview.action,
    transactionDate: preview.transactionDate,
    symbol: preview.symbol,
    securityName: preview.securityName,
    securityCurrency: preview.securityCurrency,
    quantity: preview.quantity,
    price: preview.price,
    commission: preview.commission,
    totalAmount: preview.totalAmount,
    cashAccountName: preview.cashAccountName,
    cashCurrency: preview.cashCurrency,
    cashAmount: preview.cashAmount,
    description: preview.description,
  };
}

/**
 * Builds the signed `PendingAiAction` envelopes for human-in-the-loop write
 * actions from an already-resolved preview.
 *
 * Both surfaces that propose writes share this single source of truth: the AI
 * Assistant tool executor (`ToolExecutorService`) and the MCP write tools
 * (which, when serving a relayed browser prompt, emit the same card to the web
 * chat). Keeping the descriptor/signature/preview construction here guarantees
 * the two surfaces produce byte-identical actions that the confirm endpoint
 * (`/ai/actions/confirm`) can verify and commit the same way.
 */
@Injectable()
export class AiActionBuilderService {
  constructor(private readonly signingService: AiActionSigningService) {}

  private newEnvelope(): { actionId: string; expiresAt: number } {
    return {
      actionId: randomUUID(),
      expiresAt: Date.now() + AI_ACTION_TTL_MS,
    };
  }

  buildCreateTransaction(
    userId: string,
    preview: CreateTransactionPreview,
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreateTransactionDescriptor = {
      type: "create_transaction",
      userId,
      actionId,
      expiresAt,
      accountId: preview.accountId,
      amount: preview.amount,
      transactionDate: preview.transactionDate,
      payeeId: preview.payeeId,
      payeeName: preview.payeeName,
      createPayee: preview.payeeWillBeCreated,
      categoryId: preview.categoryId,
      description: preview.description,
      currencyCode: preview.currencyCode,
    };
    return {
      actionId,
      type: "create_transaction",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: {
        accountName: preview.accountName,
        amount: preview.amount,
        currencyCode: preview.currencyCode,
        transactionDate: preview.transactionDate,
        payeeName: preview.payeeName,
        payeeWillBeCreated: preview.payeeWillBeCreated,
        categoryName: preview.categoryName,
        description: preview.description,
      },
    };
  }

  buildCategorizeTransaction(
    userId: string,
    preview: CategorizeTransactionPreview,
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CategorizeTransactionDescriptor = {
      type: "categorize_transaction",
      userId,
      actionId,
      expiresAt,
      transactionId: preview.transactionId,
      categoryId: preview.categoryId,
    };
    return {
      actionId,
      type: "categorize_transaction",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: {
        payeeName: preview.payeeName,
        amount: preview.amount,
        transactionDate: preview.transactionDate,
        // AiActionPreview.accountName is non-nullable display text; a
        // transaction without a resolvable account name omits it.
        accountName: preview.accountName ?? undefined,
        currentCategoryName: preview.currentCategoryName,
        newCategoryName: preview.newCategoryName,
      },
    };
  }

  buildCreatePayee(
    userId: string,
    preview: CreatePayeePreview,
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreatePayeeDescriptor = {
      type: "create_payee",
      userId,
      actionId,
      expiresAt,
      name: preview.name,
      defaultCategoryId: preview.defaultCategoryId,
    };
    return {
      actionId,
      type: "create_payee",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: {
        name: preview.name,
        categoryName: preview.defaultCategoryName,
      },
    };
  }

  buildCreateSecurity(
    userId: string,
    preview: CreateSecurityPreview,
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreateSecurityDescriptor = {
      type: "create_security",
      userId,
      actionId,
      expiresAt,
      symbol: preview.symbol,
      name: preview.name,
      securityType: preview.securityType,
      exchange: preview.exchange,
      currencyCode: preview.currencyCode,
      isFavourite: preview.isFavourite,
      quoteProvider: preview.quoteProvider,
      msnInstrumentId: preview.msnInstrumentId,
    };
    return {
      actionId,
      type: "create_security",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: {
        symbol: preview.symbol,
        securityName: preview.name,
        securityType: preview.securityType,
        exchange: preview.exchange,
        securityCurrency: preview.currencyCode,
        isFavourite: preview.isFavourite,
      },
    };
  }

  buildCreateInvestmentTransaction(
    userId: string,
    preview: CreateInvestmentTransactionPreview,
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreateInvestmentTransactionDescriptor = {
      type: "create_investment_transaction",
      userId,
      actionId,
      expiresAt,
      accountId: preview.accountId,
      action: preview.action,
      transactionDate: preview.transactionDate,
      securityId: preview.securityId,
      fundingAccountId: preview.fundingAccountId,
      quantity: preview.quantity,
      price: preview.price,
      commission: preview.commission,
      exchangeRate: preview.exchangeRate,
      description: preview.description,
    };
    return {
      actionId,
      type: "create_investment_transaction",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: {
        accountName: preview.accountName,
        transactionDate: preview.transactionDate,
        investmentAction: preview.action,
        symbol: preview.symbol,
        securityName: preview.securityName,
        securityCurrency: preview.securityCurrency,
        quantity: preview.quantity,
        price: preview.price,
        commission: preview.commission,
        totalAmount: preview.totalAmount,
        cashAccountName: preview.cashAccountName,
        cashCurrency: preview.cashCurrency,
        cashAmount: preview.cashAmount,
        description: preview.description,
      },
    };
  }

  /**
   * Build the signed envelope for a bulk cash-transaction action. `okPreviews`
   * are the resolved rows that will be created (mapped into the signed
   * descriptor in order); `previewRows` is the full display table -- every
   * pasted row, valid and flagged -- shown on the confirmation card.
   */
  buildCreateTransactions(
    userId: string,
    okPreviews: CreateTransactionPreview[],
    previewRows: AiActionPreviewRow[],
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreateTransactionsDescriptor = {
      type: "create_transactions",
      userId,
      actionId,
      expiresAt,
      rows: okPreviews.map((preview) => ({
        accountId: preview.accountId,
        amount: preview.amount,
        transactionDate: preview.transactionDate,
        payeeId: preview.payeeId,
        payeeName: preview.payeeName,
        createPayee: preview.payeeWillBeCreated,
        categoryId: preview.categoryId,
        description: preview.description,
        currencyCode: preview.currencyCode,
      })),
    };
    return {
      actionId,
      type: "create_transactions",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: { rows: previewRows },
    };
  }

  /**
   * Build the signed envelope for a bulk investment-transaction action. See
   * `buildCreateTransactions` for the split between the signed `okPreviews` and
   * the display-only `previewRows`.
   */
  buildCreateInvestmentTransactions(
    userId: string,
    okPreviews: CreateInvestmentTransactionPreview[],
    previewRows: AiActionPreviewRow[],
  ): PendingAiAction {
    const { actionId, expiresAt } = this.newEnvelope();
    const descriptor: CreateInvestmentTransactionsDescriptor = {
      type: "create_investment_transactions",
      userId,
      actionId,
      expiresAt,
      rows: okPreviews.map((preview) => ({
        accountId: preview.accountId,
        action: preview.action,
        transactionDate: preview.transactionDate,
        securityId: preview.securityId,
        fundingAccountId: preview.fundingAccountId,
        quantity: preview.quantity,
        price: preview.price,
        commission: preview.commission,
        exchangeRate: preview.exchangeRate,
        description: preview.description,
      })),
    };
    return {
      actionId,
      type: "create_investment_transactions",
      expiresAt,
      descriptor,
      signature: this.signingService.sign(descriptor),
      preview: { rows: previewRows },
    };
  }
}
