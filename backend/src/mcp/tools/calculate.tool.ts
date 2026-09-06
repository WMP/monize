import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { toolResult, toolError } from "../mcp-context";
import { executeCalculation } from "../../ai/query/calculate-tool";
import { calculateOutput } from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";
import { numberArg } from "../../common/tool-schemas";

@Injectable()
export class McpCalculateTools {
  register(server: McpServer) {
    server.registerTool(
      "calculate",
      {
        title: "Calculate",
        annotations: READ_ONLY,
        description:
          "Server-side arithmetic on numbers from previous tool results. Use " +
          "it instead of doing the maths yourself.",
        inputSchema: z.object({
          operation: z
            .enum(["percentage", "difference", "ratio", "sum", "average"])
            .describe(
              "percentage: (values[0]/values[1])*100. difference: values[0]-values[1]. ratio: values[0]/values[1]. sum and average take every value.",
            ),
          values: z
            .array(numberArg())
            .min(1)
            .max(100)
            .describe("Numbers to calculate with"),
          label: z
            .string()
            .max(200)
            .optional()
            .describe("Optional label (e.g., 'savings rate')"),
        }),
        outputSchema: calculateOutput,
      },
      async (args) => {
        const result = executeCalculation({
          operation: args.operation,
          values: args.values,
          label: args.label,
        });

        if ("error" in result) {
          return toolError(result.error);
        }

        return toolResult(result);
      },
    );
  }
}
