import { McpPayeeCategorizationTools } from "./payee-categorization.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpPayeeCategorizationTools", () => {
  let tool: McpPayeeCategorizationTools;
  let payeesService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  const sampleData = {
    payees: [
      {
        payeeId: "payee-1",
        payeeName: "Starbucks",
        defaultCategoryId: null,
        defaultCategoryName: null,
        transactionCount: 3,
        transactions: [
          {
            date: "2026-01-10",
            amount: -5.5,
            currencyCode: "USD",
            description: "Latte",
            tags: ["credit-card"],
            accountName: "Checking",
            accountType: "CHEQUING",
            categoryName: null,
            status: "CLEARED",
          },
        ],
      },
    ],
    categories: [
      { id: "cat-1", name: "Coffee", parentId: null, isIncome: false },
    ],
    returnedPayees: 1,
  };

  beforeEach(() => {
    payeesService = {
      getCategorizationContext: jest.fn().mockResolvedValue(sampleData),
    };

    tool = new McpPayeeCategorizationTools(payeesService as any);

    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
    };

    resolve = jest.fn();
    tool.register(server as any, resolve);
  });

  it("should register 1 tool", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
  });

  describe("get_payee_categorization_context", () => {
    it("returns error when no user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["get_payee_categorization_context"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("returns error when scope is insufficient", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "write_only" } as any);
      const result = await handlers["get_payee_categorization_context"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("delegates to payeesService.getCategorizationContext with defaults", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });

      const result = await handlers["get_payee_categorization_context"](
        {},
        { sessionId: "s1" },
      );

      expect(payeesService.getCategorizationContext).toHaveBeenCalledWith("u1", {
        onlyUncategorized: undefined,
        limit: undefined,
        minTransactions: undefined,
        maxTransactionsPerPayee: undefined,
        payeeIds: undefined,
        includeCategoryTree: undefined,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.returnedPayees).toBe(1);
      expect(parsed.payees[0].transactions[0].tags).toEqual(["credit-card"]);
      expect(parsed.categories[0].name).toBe("Coffee");
    });

    it("passes options through", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });

      await handlers["get_payee_categorization_context"](
        {
          onlyUncategorized: false,
          limit: 20,
          minTransactions: 3,
          maxTransactionsPerPayee: 10,
          payeeIds: ["11111111-1111-4111-8111-111111111111"],
          includeCategoryTree: false,
        },
        { sessionId: "s1" },
      );

      expect(payeesService.getCategorizationContext).toHaveBeenCalledWith("u1", {
        onlyUncategorized: false,
        limit: 20,
        minTransactions: 3,
        maxTransactionsPerPayee: 10,
        payeeIds: ["11111111-1111-4111-8111-111111111111"],
        includeCategoryTree: false,
      });
    });

    it("handles service errors", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      payeesService.getCategorizationContext.mockRejectedValue(
        new Error("DB fail"),
      );

      const result = await handlers["get_payee_categorization_context"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });
});
