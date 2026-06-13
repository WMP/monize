import { McpPayeeSuggestionSessionTools } from "./payee-suggestion-session.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpPayeeSuggestionSessionTools", () => {
  let tool: McpPayeeSuggestionSessionTools;
  let sessionService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    sessionService = {
      savePayeeCategorySuggestions: jest
        .fn()
        .mockResolvedValue({ sessionId: "sess-1", savedCount: 2 }),
    };

    tool = new McpPayeeSuggestionSessionTools(sessionService as any);

    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
    };

    resolve = jest.fn();
    tool.register(server as any, resolve);
  });

  it("registers exactly 1 tool", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(handlers.save_payee_category_suggestions).toBeDefined();
  });

  it("returns error when no user context", async () => {
    resolve.mockReturnValue(undefined);
    const result = await handlers.save_payee_category_suggestions(
      { suggestions: [] },
      { sessionId: "s1" },
    );
    expect(result.isError).toBe(true);
  });

  it("requires the write scope", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" } as any);
    const result = await handlers.save_payee_category_suggestions(
      { suggestions: [{ payeeId: "p1", categoryId: "c1" }] },
      { sessionId: "s1" },
    );
    expect(result.content[0].text).toContain("write");
    expect(sessionService.savePayeeCategorySuggestions).not.toHaveBeenCalled();
  });

  it("saves a draft and returns the session result", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read,write" } as any);
    const result = await handlers.save_payee_category_suggestions(
      {
        title: "draft",
        suggestions: [
          { payeeId: "p1", categoryId: "c1" },
          { payeeId: "p2", newCategoryName: "New" },
        ],
      },
      { sessionId: "s1" },
    );
    expect(sessionService.savePayeeCategorySuggestions).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        title: "draft",
        suggestions: expect.any(Array),
      }),
    );
    expect(result.content[0].text).toContain("sess-1");
  });

  it("surfaces service errors via safeToolError", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "write" } as any);
    sessionService.savePayeeCategorySuggestions.mockRejectedValue(
      new Error("boom"),
    );
    const result = await handlers.save_payee_category_suggestions(
      { suggestions: [{ payeeId: "p1", categoryId: "c1" }] },
      { sessionId: "s1" },
    );
    expect(result.isError).toBe(true);
  });
});
