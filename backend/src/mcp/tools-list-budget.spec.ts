import { McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { collectToolConfigs } from "./testing/collect-tool-configs";
import { McpServerService } from "./mcp-server.service";

/**
 * Every byte of `tools/list` rides in the model's context on EVERY request, and
 * the server instructions ride beside it. Nothing measured that, so the payload
 * grew to ~11,600 tokens for 20 tools: each defect fix appended a paragraph, the
 * same fact was stated in the tool description AND the field description AND the
 * instructions, and enum members were spelled out in prose beside the `z.enum`
 * that already carries them.
 *
 * This spec serializes the real `tools/list` through the SDK (the same
 * JSON-Schema conversion a client receives) and fails when a tool, the total, or
 * the instructions exceed their budget. Raising a cap is a reviewed decision,
 * not a fix for a failing build.
 */

// Bytes of serialized JSON per tool in the `tools/list` result, pinned to the
// measured size. A cap is a ratchet: lower it when a tool shrinks, and raise one
// only as a reviewed decision. The whole table dropped ~9% when the server moved
// to the v2 SDK, whose Standard JSON Schema emission is more compact than the
// 1.x converter -- the definitions did not change, so the caps came down with
// the measurement rather than banking the slack.
const TOOL_BYTE_BUDGET: Record<string, number> = {
  list_accounts: 2050,
  list_transactions: 3550,
  compare_periods: 1900,
  manage_transactions: 5950,
  list_categories: 1200,
  list_payees: 2150,
  manage_payees: 3000,
  generate_report: 2800,
  get_portfolio_summary: 3100,
  list_investment_transactions: 2450,
  list_capital_gains: 2050,
  lookup_securities: 1550,
  manage_securities: 4200,
  manage_investment_transactions: 4500,
  list_upcoming_bills: 3000,
  calculate: 1200,
  get_budget_status: 2550,
  get_next_prompt: 1400,
  post_response: 1050,
  report_progress: 1250,
};

const TOTAL_BYTE_BUDGET = 50_500;
const INSTRUCTIONS_BYTE_BUDGET = 2_600;

/**
 * The order the SDK lists tools in, which follows the registration order in
 * `mcp-server.service.ts`. MCP revision 2026-07-28 asks servers to return
 * `tools/list` in a deterministic order; this pins ours so a reordered
 * registration is a visible decision (clients cache the list).
 */
const EXPECTED_TOOL_ORDER = [
  "list_accounts",
  "list_transactions",
  "compare_periods",
  "manage_transactions",
  "list_categories",
  "list_payees",
  "manage_payees",
  "generate_report",
  "get_portfolio_summary",
  "list_investment_transactions",
  "list_capital_gains",
  "lookup_securities",
  "manage_securities",
  "manage_investment_transactions",
  "list_upcoming_bills",
  "calculate",
  "get_budget_status",
  "get_next_prompt",
  "post_response",
  "report_progress",
];

/**
 * Phrases that describe the codebase's history or another surface rather than
 * telling the model how to use the tool. Each one is paid for on every request.
 */
const BANNED_DESCRIPTION_PHRASES: Array<{ phrase: string; why: string }> = [
  {
    phrase: "Returns the same shape as the AI Assistant",
    why: "an MCP client cannot see the AI Assistant's tools",
  },
  {
    phrase: "Shares the lookup logic with the AI Assistant",
    why: "an MCP client cannot see the AI Assistant's tools",
  },
  {
    phrase: "replaces the former",
    why: "renamed-tool history guides nobody",
  },
  {
    phrase: "This single tool replaces",
    why: "renamed-tool history guides nobody",
  },
];

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

async function listRealTools(): Promise<{
  tools: ListedTool[];
  bytesByTool: Map<string, number>;
}> {
  const server = new McpServer(
    { name: "monize-budget", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  for (const { name, config } of collectToolConfigs()) {
    server.registerTool(name, config, () => ({
      content: [{ type: "text" as const, text: "{}" }],
      structuredContent: {},
    }));
  }

  const client = new Client(
    { name: "budget-client", version: "0.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    const bytesByTool = new Map<string, number>();
    for (const tool of listed.tools) {
      bytesByTool.set(tool.name, JSON.stringify(tool).length);
    }
    return { tools: listed.tools as ListedTool[], bytesByTool };
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * Bytes per token for this payload, calibrated against a real tokenizer: the
 * 78,207-byte baseline measured here was reported as 11,602 tokens, so the
 * naive bytes/4 rule overstates it by two thirds. JSON with repeated keys and
 * structure tokenizes far better than prose.
 */
const BYTES_PER_TOKEN = 6.7;

/** A table of every tool's size, so the numbers are visible in the failure. */
function sizeTable(bytesByTool: Map<string, number>): string {
  const rows = [...bytesByTool.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0);
  const lines = rows.map(([name, bytes]) => {
    const budget = TOOL_BYTE_BUDGET[name];
    const flag = budget !== undefined && bytes > budget ? "  OVER" : "";
    return `  ${name.padEnd(32)} ${String(bytes).padStart(6)} bytes  ~${String(
      Math.round(bytes / BYTES_PER_TOKEN),
    ).padStart(5)} tokens (budget ${budget ?? "unset"})${flag}`;
  });
  lines.push(
    `  ${"TOTAL".padEnd(32)} ${String(total).padStart(6)} bytes  ~${String(
      Math.round(total / BYTES_PER_TOKEN),
    ).padStart(5)} tokens (budget ${TOTAL_BYTE_BUDGET})`,
  );
  return `\ntools/list payload:\n${lines.join("\n")}\n`;
}

/** Every enum in a serialized JSON Schema, keyed by the property that holds it. */
function enumsByProperty(schema: unknown): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (node: unknown, propertyName: string | null) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.enum) && propertyName) {
      const members = obj.enum.filter(
        (v): v is string => typeof v === "string",
      );
      if (members.length >= 3) found.set(propertyName, members);
    }
    if (obj.properties && typeof obj.properties === "object") {
      for (const [key, value] of Object.entries(
        obj.properties as Record<string, unknown>,
      )) {
        walk(value, key);
      }
    }
    if (obj.items) walk(obj.items, propertyName);
  };
  walk(schema, null);
  return found;
}

/** Every `description` in a serialized JSON Schema, keyed by its property. */
function describesByProperty(schema: unknown): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (node: unknown, propertyName: string | null) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.description === "string" && propertyName) {
      found.set(propertyName, obj.description);
    }
    if (obj.properties && typeof obj.properties === "object") {
      for (const [key, value] of Object.entries(
        obj.properties as Record<string, unknown>,
      )) {
        walk(value, key);
      }
    }
    if (obj.items) walk(obj.items, propertyName);
  };
  walk(schema, null);
  return found;
}

/**
 * Does `text` copy out an enum's member LIST, rather than merely using words
 * that happen to be members? A restated list runs member -> separator ->
 * member; ordinary prose puts other words between them.
 */
function restatesList(text: string, members: string[]): boolean {
  const escaped = members
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const hits = [...text.matchAll(new RegExp(`\\b(${escaped})\\b`, "g"))];
  let run: string[] = [];
  let previousEnd = -1;
  for (const hit of hits) {
    const gap = previousEnd < 0 ? "" : text.slice(previousEnd, hit.index);
    const isSeparator =
      /^[\s,/|'"()\][-]*(?:or|and|then)?[\s,/|'"()\][-]*$/.test(gap);
    run = previousEnd >= 0 && isSeparator ? [...run, hit[1]] : [hit[1]];
    if (new Set(run).size >= 3) return true;
    previousEnd = (hit.index ?? 0) + hit[0].length;
  }
  return false;
}

describe("tools/list payload budget", () => {
  let tools: ListedTool[];
  let bytesByTool: Map<string, number>;

  beforeAll(async () => {
    ({ tools, bytesByTool } = await listRealTools());
  });

  it("keeps every tool within its byte budget", () => {
    const report = sizeTable(bytesByTool);
    const over = [...bytesByTool.entries()]
      .filter(([name, bytes]) => {
        const budget = TOOL_BYTE_BUDGET[name];
        return budget === undefined || bytes > budget;
      })
      .map(
        ([name, bytes]) =>
          `${name}: ${bytes} bytes exceeds budget ${TOOL_BYTE_BUDGET[name] ?? "(unset)"}`,
      );

    // Compared against the report itself so a failure prints the whole table.
    expect(
      over.length === 0
        ? report
        : `${report}\nOVER BUDGET:\n${over.join("\n")}`,
    ).toBe(report);
  });

  it("keeps the whole payload within the total budget", () => {
    const report = sizeTable(bytesByTool);
    const total = [...bytesByTool.values()].reduce((a, b) => a + b, 0);
    const verdict =
      total <= TOTAL_BYTE_BUDGET
        ? report
        : `${report}\nTOTAL ${total} exceeds budget ${TOTAL_BYTE_BUDGET}`;
    expect(verdict).toBe(report);
  });

  it("keeps the server instructions within budget", () => {
    // The instructions are built independently of tool registration, so empty
    // provider doubles are enough to read them back off the server.
    const noopProvider = { register: () => {} } as any;
    const service = new McpServerService(
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      {} as any,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
      noopProvider,
    );
    const server = service.createServer();
    const instructions = (server.server as any)._instructions as string;

    expect(typeof instructions).toBe("string");
    const verdict =
      instructions.length <= INSTRUCTIONS_BYTE_BUDGET
        ? "within budget"
        : `instructions are ${instructions.length} bytes (~${Math.round(instructions.length / BYTES_PER_TOKEN)} tokens), budget ${INSTRUCTIONS_BYTE_BUDGET}`;
    expect(verdict).toBe("within budget");
  });

  it("lists tools in a deterministic, pinned order", () => {
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_ORDER);
  });
  it("never restates an enum's members in prose", () => {
    // A `z.enum` already ships its members in the JSON Schema, so listing them
    // again in prose pays for the list twice. What counts as restating is the
    // LIST, not the words: "create, edit or delete" is ordinary English about
    // what the tool does, while "'bill', 'deposit', 'transfer'" is the enum
    // copied out. So a run of three or more members separated by nothing but
    // list punctuation is the offence, and the enum's OWN field may of course
    // explain its members.
    const offenders: string[] = [];
    for (const tool of tools) {
      const enums = enumsByProperty(tool.inputSchema);
      if (enums.size === 0) continue;
      const describes = describesByProperty(tool.inputSchema);
      for (const [property, members] of enums) {
        const restated = (text: string) => restatesList(text, members);
        if (tool.description && restated(tool.description)) {
          offenders.push(
            `${tool.name}: description restates the '${property}' enum`,
          );
        }
        for (const [otherProperty, text] of describes) {
          if (otherProperty !== property && restated(text)) {
            offenders.push(
              `${tool.name}: '${otherProperty}' describe restates the '${property}' enum`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps codebase history and sibling-surface references out of descriptions", () => {
    const offenders: string[] = [];
    for (const tool of tools) {
      for (const { phrase, why } of BANNED_DESCRIPTION_PHRASES) {
        if (tool.description?.includes(phrase)) {
          offenders.push(`${tool.name}: "${phrase}" (${why})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every field description short enough to scan", () => {
    // An enum's own field is where its members are explained, so it is allowed
    // more room than a field that only says how to fill itself.
    const MAX_DESCRIBE_CHARS = 300;
    const MAX_ENUM_DESCRIBE_CHARS = 600;
    const offenders: string[] = [];
    for (const tool of tools) {
      const enums = enumsByProperty(tool.inputSchema);
      for (const [property, text] of describesByProperty(tool.inputSchema)) {
        const cap = enums.has(property)
          ? MAX_ENUM_DESCRIBE_CHARS
          : MAX_DESCRIBE_CHARS;
        if (text.length > cap) {
          offenders.push(`${tool.name}.${property}: ${text.length} > ${cap}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
