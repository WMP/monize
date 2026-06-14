import { getErrorMessage } from '@/lib/errors';

/**
 * Minimal shape of a WebMCP tool result (MCP content blocks). The
 * `navigator.modelContext` runtime (polyfilled by `@mcp-b/global`) expects
 * `execute` to resolve to `{ content: [...] }`, optionally flagged `isError`.
 */
export interface WebMcpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<WebMcpToolResult>;
}

/** Wrap any JSON-serializable value as a text content result. */
export function toolResult(data: unknown): WebMcpToolResult {
  const text =
    typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Build an error result the agent can read and recover from. */
export function toolError(message: string): WebMcpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Define a tool whose handler is wrapped so a thrown error (e.g. a failed API
 * call) becomes a readable `isError` result instead of rejecting -- the agent
 * gets the message rather than an opaque transport failure.
 */
export function defineTool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  run: (args: Record<string, unknown>) => Promise<unknown>,
): WebMcpTool {
  return {
    name,
    description,
    inputSchema,
    execute: async (args) => {
      try {
        return toolResult(await run(args ?? {}));
      } catch (error) {
        return toolError(getErrorMessage(error, `Tool "${name}" failed`));
      }
    },
  };
}

const EMPTY_SCHEMA: JsonSchema = { type: 'object', properties: {} };
export { EMPTY_SCHEMA };
