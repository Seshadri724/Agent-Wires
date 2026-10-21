import { startMcpProxy } from "../../adapters/mcpProxy.ts";

export type McpCommandParseResult =
  | { sessionArg?: string; cwdArg?: string; serverArg?: string; targetArgs: string[] }
  | { error: string };

export function parseMcpCommandArgs(args: string[]): McpCommandParseResult {
  let sessionArg: string | undefined;
  let cwdArg: string | undefined;
  let serverArg: string | undefined;
  let commandIndex = 0;
  for (; commandIndex < args.length; commandIndex++) {
    const arg = args[commandIndex];
    if (!arg.startsWith("--")) break;
    if (arg.startsWith("--session=")) sessionArg = arg.slice("--session=".length);
    else if (arg.startsWith("--cwd=")) cwdArg = arg.slice("--cwd=".length);
    else if (arg.startsWith("--server=")) serverArg = arg.slice("--server=".length);
    else return { error: `Unknown mcp-proxy option: ${arg}` };
  }

  const targetArgs = args.slice(commandIndex);
  if (targetArgs.length === 0) return { error: "Missing MCP server command" };
  return { sessionArg, cwdArg, serverArg, targetArgs };
}

export function runMcpCommand(args: string[]): void {
  const parsed = parseMcpCommandArgs(args);
  if ("error" in parsed) {
    console.error(`canarywatch mcp-proxy: ${parsed.error}`);
    console.error("Usage: canarywatch mcp-proxy [--session=ID] [--cwd=DIR] [--server=NAME] <command> [args...]");
    process.exitCode = 1;
    return;
  }

  const [cmd, ...cmdRest] = parsed.targetArgs;
  startMcpProxy(cmd, cmdRest, {
    sessionId: parsed.sessionArg,
    cwd: parsed.cwdArg,
    mcpServerName: parsed.serverArg,
  });
}
