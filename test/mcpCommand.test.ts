import test from "node:test";
import assert from "node:assert/strict";
import { parseMcpCommandArgs } from "../src/cli/commands/mcpCommand.ts";

test("mcp-proxy preserves server flags after the command", () => {
  const parsed = parseMcpCommandArgs([
    "--session=pilot-1",
    "--cwd=C:/work/repo",
    "node",
    "--inspect=0",
    "--server-flag",
    "value",
  ]);
  assert.deepEqual(parsed, {
    sessionArg: "pilot-1",
    cwdArg: "C:/work/repo",
    serverArg: undefined,
    targetArgs: ["node", "--inspect=0", "--server-flag", "value"],
  });
});

test("mcp-proxy reports unknown options before the command", () => {
  assert.deepEqual(parseMcpCommandArgs(["--unknown", "node"]), { error: "Unknown mcp-proxy option: --unknown" });
});
