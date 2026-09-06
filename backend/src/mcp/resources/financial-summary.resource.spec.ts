import { McpFinancialSummaryResource } from "./financial-summary.resource";
import { mcpTestCtx, McpTestContext } from "../testing/mcp-test-context";

describe("McpFinancialSummaryResource", () => {
  let resource: McpFinancialSummaryResource;
  let accountsService: Record<string, jest.Mock>;
  let analyticsService: Record<string, jest.Mock>;
  let server: { registerResource: jest.Mock };
  let ctx: McpTestContext;
  let handler: (...args: any[]) => any;

  beforeEach(() => {
    accountsService = {
      getSummary: jest.fn(),
    };

    analyticsService = {
      getSummary: jest.fn(),
    };

    resource = new McpFinancialSummaryResource(
      accountsService as any,
      analyticsService as any,
    );

    server = {
      registerResource: jest.fn((_name, _uri, _opts, h) => {
        handler = h;
      }),
    };

    ctx = mcpTestCtx();
    resource.register(server as any);
  });

  it("should register the resource", () => {
    expect(server.registerResource).toHaveBeenCalledWith(
      "financial-summary",
      "monize://financial-summary",
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("should return error when no user context", async () => {
    ctx.setUser(undefined);
    const result = await handler("monize://financial-summary", ctx);
    expect(result.contents[0].text).toContain("Error");
  });

  it("should return error when scope check fails", async () => {
    ctx.setUser({ userId: "u1", scopes: "write" });
    const result = await handler("monize://financial-summary", ctx);
    expect(result.contents[0].text).toContain("Insufficient scope");
  });

  it("should return financial summary with net worth and current month", async () => {
    ctx.setUser({ userId: "u1", scopes: "read" });
    accountsService.getSummary.mockResolvedValue({
      totalAssets: 10000,
      totalLiabilities: 2000,
      netWorth: 8000,
    });
    analyticsService.getSummary.mockResolvedValue({
      totalIncome: 5000,
      totalExpenses: -3000,
    });

    const result = await handler("monize://financial-summary", ctx);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.netWorth.netWorth).toBe(8000);
    expect(parsed.currentMonth.totalIncome).toBe(5000);
    expect(parsed.currentMonth.period).toBeDefined();
  });

  it("excludes investment-linked cash transactions from the MCP summary", async () => {
    ctx.setUser({ userId: "u1", scopes: "read" });
    accountsService.getSummary.mockResolvedValue({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
    analyticsService.getSummary.mockResolvedValue({
      totalIncome: 0,
      totalExpenses: 0,
    });

    await handler("monize://financial-summary", ctx);

    // 10th positional arg is excludeInvestmentLinked.
    const args = analyticsService.getSummary.mock.calls[0];
    expect(args[9]).toBe(true);
  });
});
