import { startMcpProxy } from "../../adapters/mcpProxy.ts";

export function runMcpCommand(args: string[]): void {
  const sessionArg = args.find((a) => a.startsWith("--session="))?.split("=")[1];
  const cwdArg = args.find((a) => a.startsWith("--cwd="))?.split("=")[1];
  const serverArg = args.find((a) => a.startsWith("--server="))?.split("=")[1];

  const targetArgs = args.filter((a) => !a.startsWith("--"));

  if (targetArgs.length === 0) {
    console.error("Usage: canarywatch mcp-proxy [--session=ID] [--cwd=DIR] [--server=NAME] <command> [args...]");
    process.exitCode = 1;
    return;
  }

  const [cmd, ...cmdRest] = targetArgs;
  startMcpProxy(cmd, cmdRest, {
    sessionId: sessionArg,
    cwd: cwdArg,
    mcpServerName: serverArg,
  });
}
