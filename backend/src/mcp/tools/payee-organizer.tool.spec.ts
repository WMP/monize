import { McpPayeeOrganizerTools } from "./payee-organizer.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpPayeeOrganizerTools", () => {
  let tool: McpPayeeOrganizerTools;
  let payeeOrganizerService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    payeeOrganizerService = {
      suggest: jest.fn(),
      apply: jest.fn(),
    };

    tool = new McpPayeeOrganizerTools(payeeOrganizerService as any);

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
    expect(handlers["suggest_payee_organization"]).toBeDefined();
    expect(handlers["apply_payee_organization"]).toBeDefined();
  });

  describe("suggest_payee_organization", () => {
    it("requires read scope and returns suggestions", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      payeeOrganizerService.suggest.mockResolvedValue({
        categorySuggestions: [],
        mergeGroups: [],
        model: "m",
      });

      const result = await handlers["suggest_payee_organization"](
        { allowNewCategories: true },
        { sessionId: "s1" },
      );

      expect(payeeOrganizerService.suggest).toHaveBeenCalledWith("u1", {
        allowNewCategories: true,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.model).toBe("m");
    });

    it("defaults allowNewCategories to false", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      payeeOrganizerService.suggest.mockResolvedValue({
        categorySuggestions: [],
        mergeGroups: [],
        model: "m",
      });

      await handlers["suggest_payee_organization"]({}, { sessionId: "s1" });
      expect(payeeOrganizerService.suggest).toHaveBeenCalledWith("u1", {
        allowNewCategories: false,
      });
    });

    it("errors without user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["suggest_payee_organization"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("errors when the service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      payeeOrganizerService.suggest.mockRejectedValue(new Error("boom"));
      const result = await handlers["suggest_payee_organization"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });

  describe("apply_payee_organization", () => {
    it("requires write scope", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      const result = await handlers["apply_payee_organization"](
        { categoryAssignments: [], merges: [] },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
      expect(payeeOrganizerService.apply).not.toHaveBeenCalled();
    });

    it("applies selections with write scope", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      payeeOrganizerService.apply.mockResolvedValue({
        categoriesCreated: 1,
        payeesCategorized: 2,
        payeesMerged: 3,
      });

      const result = await handlers["apply_payee_organization"](
        {
          categoryAssignments: [
            { payeeId: "p1", categoryId: "c1" },
          ],
          merges: [{ targetPayeeId: "t1", sourcePayeeIds: ["s1"] }],
        },
        { sessionId: "s1" },
      );

      expect(payeeOrganizerService.apply).toHaveBeenCalledWith("u1", {
        categoryAssignments: [{ payeeId: "p1", categoryId: "c1" }],
        merges: [{ targetPayeeId: "t1", sourcePayeeIds: ["s1"] }],
        rejectedMerges: [],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.payeesMerged).toBe(3);
    });

    it("passes empty arrays when fields omitted", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      payeeOrganizerService.apply.mockResolvedValue({
        categoriesCreated: 0,
        payeesCategorized: 0,
        payeesMerged: 0,
      });

      await handlers["apply_payee_organization"]({}, { sessionId: "s1" });
      expect(payeeOrganizerService.apply).toHaveBeenCalledWith("u1", {
        categoryAssignments: [],
        merges: [],
        rejectedMerges: [],
      });
    });

    it("forwards rejectedMerges to the service", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      payeeOrganizerService.apply.mockResolvedValue({
        categoriesCreated: 0,
        payeesCategorized: 0,
        payeesMerged: 0,
        mergeRejectionsSaved: 1,
      });

      await handlers["apply_payee_organization"](
        {
          categoryAssignments: [],
          merges: [],
          rejectedMerges: [
            { canonicalPayeeId: "c1", duplicatePayeeIds: ["d1"] },
          ],
        },
        { sessionId: "s1" },
      );

      expect(payeeOrganizerService.apply).toHaveBeenCalledWith("u1", {
        categoryAssignments: [],
        merges: [],
        rejectedMerges: [{ canonicalPayeeId: "c1", duplicatePayeeIds: ["d1"] }],
      });
    });

    it("errors when the service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read,write" });
      payeeOrganizerService.apply.mockRejectedValue(new Error("boom"));
      const result = await handlers["apply_payee_organization"](
        { categoryAssignments: [], merges: [] },
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });
});
