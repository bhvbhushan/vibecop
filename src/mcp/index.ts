import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  scanInputSchema,
  handleScan,
  checkInputSchema,
  handleCheck,
  explainInputSchema,
  handleExplain,
} from "./server.js";

/** Read version from package.json */
function getVersion(): string {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

/** Create and configure the MCP server with all vibecop tools */
export function createServer(): McpServer {
  const version = getVersion();

  const server = new McpServer({
    name: "vibecop",
    version,
  });

  server.registerTool("vibecop_scan", {
    description:
      "Scan a directory for AI code quality issues. Returns findings with file, line, severity, and suggestions.",
    inputSchema: scanInputSchema,
  }, handleScan);

  server.registerTool("vibecop_check", {
    description: "Check a single file for AI code quality issues.",
    inputSchema: checkInputSchema,
  }, handleCheck);

  server.registerTool("vibecop_explain", {
    description:
      "Explain what a vibecop detector checks for, its severity, and category.",
    inputSchema: explainInputSchema,
  }, handleExplain);

  return server;
}

/** Start the MCP server with stdio transport */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  // Log to stderr so it doesn't interfere with the MCP protocol on stdout
  console.error("vibecop MCP server running on stdio");
}
