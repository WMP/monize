import { McpBrokerImportTools } from "./broker-import.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpBrokerImportTools", () => {
  let tool: McpBrokerImportTools;
  let brokerImportService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    brokerImportService = {
      parse: jest.fn(),
      apply: jest.fn(),
    };

    tool = new McpBrokerImportTools(brokerImportService as any);

    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
    };

    resolve = jest.fn();
    tool.register(server as any, resolve);
  });

  it("registers both tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(handlers["parse_broker_import"]).toBeDefined();
    expect(handlers["apply_broker_import"]).toBeDefined();
  });

  describe("parse_broker_import", () => {
    it("requires read scope and returns parsed orders", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      brokerImportService.parse.mockResolvedValue({
        orders: [],
        model: "m",
        warnings: [],
      });

      const result = await handlers["parse_broker_import"](
        { html: "<table></table>" },
        { sessionId: "s1" },
      );

      expect(brokerImportService.parse).toHaveBeenCalledWith("u1", {
        html: "<table></table>",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.model).toBe("m");
    });

    it("errors without user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["parse_broker_import"](
        { html: "x" },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("errors when the service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      brokerImportService.parse.mockRejectedValue(new Error("boom"));
      const result = await handlers["parse_broker_import"](
        { html: "x" },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });

  describe("apply_broker_import", () => {
    it("requires write scope", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      const result = await handlers["apply_broker_import"](
        { accountId: "acct-1", orders: [] },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
      expect(brokerImportService.apply).not.toHaveBeenCalled();
    });

    it("applies orders with write scope", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      brokerImportService.apply.mockResolvedValue({
        created: 1,
        securitiesCreated: 0,
        skipped: 0,
        errors: [],
      });

      const orders = [
        {
          securityId: "sec-1",
          side: "BUY",
          quantity: 1,
          price: 1,
          commission: 0,
          currency: "EUR",
          tradeDate: "2026-06-05",
        },
      ];
      const result = await handlers["apply_broker_import"](
        { accountId: "acct-1", orders },
        { sessionId: "s1" },
      );

      expect(brokerImportService.apply).toHaveBeenCalledWith("u1", {
        accountId: "acct-1",
        orders,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.created).toBe(1);
    });

    it("passes an empty orders array when omitted", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      brokerImportService.apply.mockResolvedValue({
        created: 0,
        securitiesCreated: 0,
        skipped: 0,
        errors: [],
      });

      await handlers["apply_broker_import"](
        { accountId: "acct-1" },
        { sessionId: "s1" },
      );
      expect(brokerImportService.apply).toHaveBeenCalledWith("u1", {
        accountId: "acct-1",
        orders: [],
      });
    });

    it("errors when the service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      brokerImportService.apply.mockRejectedValue(new Error("boom"));
      const result = await handlers["apply_broker_import"](
        { accountId: "acct-1", orders: [] },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });
});
