import { AiActionBuilderService } from "./ai-action-builder.service";
import { AiActionSigningService } from "./ai-action-signing.service";
import {
  CategorizeTransactionPreview,
  CreateTransactionPreview,
} from "../../transactions/transactions.service";
import { CreatePayeePreview } from "../../payees/payees.service";
import { CreateInvestmentTransactionPreview } from "../../securities/investment-transactions.service";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";

describe("AiActionBuilderService", () => {
  let builder: AiActionBuilderService;
  let signing: { sign: jest.Mock };

  beforeEach(() => {
    signing = { sign: jest.fn().mockReturnValue("sig-123") };
    builder = new AiActionBuilderService(
      signing as unknown as AiActionSigningService,
    );
  });

  it("builds a signed create_transaction action from a preview", () => {
    const preview: CreateTransactionPreview = {
      accountId: "a1",
      accountName: "Checking",
      amount: -50,
      transactionDate: "2025-01-15",
      payeeId: "p1",
      payeeName: "Store",
      payeeMatched: true,
      payeeWillBeCreated: false,
      categoryId: "c1",
      categoryName: "Groceries",
      description: "weekly shop",
      currencyCode: "USD",
    };

    const action = builder.buildCreateTransaction("u1", preview);

    expect(action.type).toBe("create_transaction");
    expect(action.signature).toBe("sig-123");
    expect(action.expiresAt).toBeGreaterThan(Date.now());
    expect(action.descriptor).toMatchObject({
      type: "create_transaction",
      userId: "u1",
      accountId: "a1",
      amount: -50,
      payeeId: "p1",
      createPayee: false,
      categoryId: "c1",
      currencyCode: "USD",
    });
    // The descriptor (not the preview) is what gets signed.
    expect(signing.sign).toHaveBeenCalledWith(action.descriptor);
    expect(action.preview).toMatchObject({
      accountName: "Checking",
      amount: -50,
      categoryName: "Groceries",
    });
  });

  it("builds a categorize_transaction action and omits a null account name", () => {
    const preview: CategorizeTransactionPreview = {
      transactionId: "t1",
      payeeName: null,
      amount: 12,
      transactionDate: "2025-02-01",
      accountName: null,
      currentCategoryName: null,
      categoryId: "c2",
      newCategoryName: "Dining",
    };

    const action = builder.buildCategorizeTransaction("u1", preview);

    expect(action.type).toBe("categorize_transaction");
    expect(action.descriptor).toMatchObject({
      type: "categorize_transaction",
      userId: "u1",
      transactionId: "t1",
      categoryId: "c2",
    });
    expect(action.preview.accountName).toBeUndefined();
    expect(action.preview.newCategoryName).toBe("Dining");
  });

  it("builds a create_payee action", () => {
    const preview: CreatePayeePreview = {
      name: "Hydro",
      defaultCategoryId: "c3",
      defaultCategoryName: "Utilities",
    };

    const action = builder.buildCreatePayee("u1", preview);

    expect(action.type).toBe("create_payee");
    expect(action.descriptor).toMatchObject({
      type: "create_payee",
      userId: "u1",
      name: "Hydro",
      defaultCategoryId: "c3",
    });
    expect(action.preview).toMatchObject({
      name: "Hydro",
      categoryName: "Utilities",
    });
  });

  it("builds a create_security action from a preview", () => {
    const preview = {
      symbol: "AAPL",
      name: "Apple Inc.",
      securityType: "STOCK",
      exchange: "NASDAQ",
      currencyCode: "USD",
      isFavourite: true,
      quoteProvider: "yahoo" as const,
      msnInstrumentId: null,
    };

    const action = builder.buildCreateSecurity("u1", preview);

    expect(action.type).toBe("create_security");
    expect(action.descriptor).toMatchObject({
      type: "create_security",
      userId: "u1",
      symbol: "AAPL",
      name: "Apple Inc.",
      securityType: "STOCK",
      exchange: "NASDAQ",
      currencyCode: "USD",
      isFavourite: true,
      quoteProvider: "yahoo",
    });
    // The descriptor (not the preview) is what gets signed.
    expect(signing.sign).toHaveBeenCalledWith(action.descriptor);
    expect(action.preview).toMatchObject({
      symbol: "AAPL",
      securityName: "Apple Inc.",
      securityType: "STOCK",
      exchange: "NASDAQ",
      securityCurrency: "USD",
      isFavourite: true,
    });
  });

  it("builds a create_investment_transaction action", () => {
    const preview: CreateInvestmentTransactionPreview = {
      accountId: "acc1",
      accountName: "Brokerage",
      accountCurrency: "USD",
      action: InvestmentAction.BUY,
      transactionDate: "2025-03-03",
      securityId: "s1",
      symbol: "VTI",
      securityName: "Vanguard Total",
      securityCurrency: "USD",
      fundingAccountId: null,
      quantity: 10,
      price: 200,
      commission: 1,
      exchangeRate: 1,
      totalAmount: 2001,
      cashAccountName: "Brokerage Cash",
      cashCurrency: "USD",
      cashAmount: -2001,
      description: null,
    };

    const action = builder.buildCreateInvestmentTransaction("u1", preview);

    expect(action.type).toBe("create_investment_transaction");
    expect(action.descriptor).toMatchObject({
      type: "create_investment_transaction",
      userId: "u1",
      accountId: "acc1",
      action: InvestmentAction.BUY,
      securityId: "s1",
      exchangeRate: 1,
    });
    expect(action.preview).toMatchObject({
      symbol: "VTI",
      investmentAction: InvestmentAction.BUY,
      totalAmount: 2001,
    });
  });

  it("builds a bulk create_transactions action: signed rows are the valid ones, preview rows include flagged", () => {
    const ok: CreateTransactionPreview = {
      accountId: "a1",
      accountName: "Checking",
      amount: -50,
      transactionDate: "2025-01-15",
      payeeId: null,
      payeeName: "Store",
      payeeMatched: false,
      payeeWillBeCreated: true,
      categoryId: "c1",
      categoryName: "Groceries",
      description: null,
      currencyCode: "USD",
    };
    const previewRows = [
      {
        status: "ok" as const,
        accountName: "Checking",
        amount: -50,
        payeeName: "Store",
      },
      {
        status: "error" as const,
        accountName: "Nope",
        error: "Unknown account: Nope",
      },
    ];

    const action = builder.buildCreateTransactions("u1", [ok], previewRows);

    expect(action.type).toBe("create_transactions");
    expect(action.descriptor.type).toBe("create_transactions");
    if (action.descriptor.type !== "create_transactions") throw new Error();
    // Only the valid row is signed into the descriptor.
    expect(action.descriptor.rows).toHaveLength(1);
    expect(action.descriptor.rows[0]).toMatchObject({
      accountId: "a1",
      amount: -50,
      createPayee: true,
      currencyCode: "USD",
    });
    // The display preview keeps both rows in pasted order.
    expect(action.preview.rows).toHaveLength(2);
    expect(action.preview.rows?.[1].status).toBe("error");
    expect(signing.sign).toHaveBeenCalledWith(action.descriptor);
  });

  it("builds a bulk create_investment_transactions action", () => {
    const ok: CreateInvestmentTransactionPreview = {
      accountId: "acc1",
      accountName: "Brokerage",
      accountCurrency: "USD",
      action: InvestmentAction.BUY,
      transactionDate: "2025-03-03",
      securityId: "s1",
      symbol: "VTI",
      securityName: "Vanguard Total",
      securityCurrency: "USD",
      fundingAccountId: null,
      quantity: 10,
      price: 200,
      commission: 1,
      exchangeRate: 1,
      totalAmount: 2001,
      cashAccountName: "Brokerage Cash",
      cashCurrency: "USD",
      cashAmount: -2001,
      description: null,
    };

    const action = builder.buildCreateInvestmentTransactions(
      "u1",
      [ok],
      [{ status: "ok", symbol: "VTI" }],
    );

    expect(action.type).toBe("create_investment_transactions");
    if (action.descriptor.type !== "create_investment_transactions")
      throw new Error();
    expect(action.descriptor.rows).toHaveLength(1);
    expect(action.descriptor.rows[0]).toMatchObject({
      accountId: "acc1",
      action: InvestmentAction.BUY,
      securityId: "s1",
      exchangeRate: 1,
    });
    expect(action.preview.rows).toHaveLength(1);
  });
});
