import { NotFoundException } from "@nestjs/common";
import { McpWarrantiesTools } from "./warranties.tool";
import { mcpTestCtx, McpTestContext } from "../testing/mcp-test-context";
import { READ_ONLY } from "../mcp-annotations";
import { listWarrantiesSchema } from "../../ai/query/tool-input-schemas";
import type {
  LlmWarrantyList,
  WarrantiesService,
} from "../../warranties/warranties.service";

/** What `WarrantiesService.getLlmWarranties` answers for one linked row. */
const LIST: LlmWarrantyList = {
  today: "2026-10-21",
  windowDays: 30,
  warranties: [
    {
      id: "w-1",
      name: "Laptop",
      vendorName: "Best Buy",
      warrantyKind: "manufacturer",
      purchaseDate: "2026-10-01",
      expiresOn: "2026-11-01",
      isLifetime: false,
      status: "expiring",
      daysLeft: 11,
      purchasePrice: 1499.99,
      currencyCode: "CAD",
      serialNumbers: ["SN-1"],
      linkedTransactionId: "tx-1",
      openClaimCount: 0,
      documentCount: 1,
      archived: false,
    },
  ],
  total: 1,
};

describe("McpWarrantiesTools", () => {
  let warrantiesService: {
    getLlmWarranties: jest.MockedFunction<
      WarrantiesService["getLlmWarranties"]
    >;
  };
  let server: { registerTool: jest.Mock };
  let ctx: McpTestContext;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    warrantiesService = {
      getLlmWarranties: jest.fn().mockResolvedValue(LIST),
    };
    const tool = new McpWarrantiesTools(warrantiesService as any);
    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
    };
    ctx = mcpTestCtx();
    tool.register(server as any);
  });

  it("registers list_warranties read-only over the shared input schema", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    const [name, config] = server.registerTool.mock.calls[0];
    expect(name).toBe("list_warranties");
    expect(config.annotations).toBe(READ_ONLY);
    expect(config.inputSchema).toBe(listWarrantiesSchema);
    expect(config.outputSchema).toBeDefined();
  });

  it("errors when no user context exists", async () => {
    ctx.setUser(undefined);
    const result = await handlers["list_warranties"]({}, ctx);
    expect(result.isError).toBe(true);
    expect(warrantiesService.getLlmWarranties).not.toHaveBeenCalled();
  });

  it("requires the read scope", async () => {
    ctx.setUser({ userId: "u1", scopes: "write" });
    const result = await handlers["list_warranties"]({}, ctx);
    expect(result.isError).toBe(true);
    expect(warrantiesService.getLlmWarranties).not.toHaveBeenCalled();
  });

  it("answers the service's shape for the caller, with the arguments as given", async () => {
    ctx.setUser({ userId: "u1", scopes: "read" });
    const args = { status: "expiring", q: "laptop", limit: 5 };

    const result = await handlers["list_warranties"](args, ctx);

    // The owner's own credential: no account scope narrows the purchase.
    expect(warrantiesService.getLlmWarranties).toHaveBeenCalledWith("u1", args);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(LIST);
  });

  it("passes a 4xx message through", async () => {
    ctx.setUser({ userId: "u1", scopes: "read" });
    warrantiesService.getLlmWarranties.mockRejectedValueOnce(
      new NotFoundException("nothing here"),
    );
    const result = await handlers["list_warranties"]({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nothing here");
  });

  it("hides a 5xx behind a generic error", async () => {
    ctx.setUser({ userId: "u1", scopes: "read" });
    warrantiesService.getLlmWarranties.mockRejectedValueOnce(
      new Error("relation warranties does not exist"),
    );
    const result = await handlers["list_warranties"]({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("relation");
  });
});
