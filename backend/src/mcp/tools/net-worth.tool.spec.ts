import { McpNetWorthTools } from "./net-worth.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpNetWorthTools", () => {
  let tool: McpNetWorthTools;
  let netWorthService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    netWorthService = {
      getMonthlyNetWorth: jest.fn(),
      getLlmHistory: jest.fn(),
    };

    tool = new McpNetWorthTools(netWorthService as any);

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

  describe("get_net_worth_history", () => {
    it("should return monthly net worth history via shared getLlmHistory", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      netWorthService.getLlmHistory.mockResolvedValue([
        { month: "2025-01", netWorth: 7000 },
        { month: "2025-02", netWorth: 8000 },
      ]);

      const result = await handlers["get_net_worth_history"](
        {},
        { sessionId: "s1" },
      );
      expect(netWorthService.getLlmHistory).toHaveBeenCalledWith(
        "u1",
        undefined,
        undefined,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it("should compute date range from months parameter when dates omitted", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      netWorthService.getLlmHistory.mockResolvedValue([]);

      await handlers["get_net_worth_history"](
        { months: 6 },
        { sessionId: "s1" },
      );
      expect(netWorthService.getLlmHistory).toHaveBeenCalledWith(
        "u1",
        expect.any(String),
        expect.any(String),
      );
    });

    it("returns error when no user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["get_net_worth_history"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("returns error when service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      netWorthService.getLlmHistory.mockRejectedValue(new Error("boom"));
      const result = await handlers["get_net_worth_history"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });
});
