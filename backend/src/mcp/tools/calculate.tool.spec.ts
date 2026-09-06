import { McpServer } from "@modelcontextprotocol/server";
import { McpCalculateTools } from "./calculate.tool";

describe("McpCalculateTools", () => {
  let tools: McpCalculateTools;
  let mockServer: { registerTool: jest.Mock };

  beforeEach(() => {
    tools = new McpCalculateTools();
    mockServer = {
      registerTool: jest.fn(),
    };
  });

  it("registers the calculate tool", () => {
    tools.register(mockServer as unknown as McpServer);

    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "calculate",
      expect.objectContaining({
        description: expect.stringContaining("Server-side arithmetic"),
      }),
      expect.any(Function),
    );
  });

  it("executes percentage calculation", async () => {
    tools.register(mockServer as unknown as McpServer);
    const handler = mockServer.registerTool.mock.calls[0][2];

    const result = await handler({
      operation: "percentage",
      values: [300, 5000],
    });

    expect(result.content).toBeDefined();
    const data = result.structuredContent as any;
    expect(data.result).toBe(6);
    expect(data.formattedResult).toBe("6%");
  });

  it("executes sum calculation", async () => {
    tools.register(mockServer as unknown as McpServer);
    const handler = mockServer.registerTool.mock.calls[0][2];

    const result = await handler({
      operation: "sum",
      values: [0.1, 0.2],
    });

    const data = result.structuredContent as any;
    expect(data.result).toBe(0.3);
  });

  it("returns error for division by zero", async () => {
    tools.register(mockServer as unknown as McpServer);
    const handler = mockServer.registerTool.mock.calls[0][2];

    const result = await handler({
      operation: "ratio",
      values: [100, 0],
    });

    expect(result.isError).toBe(true);
  });
});
