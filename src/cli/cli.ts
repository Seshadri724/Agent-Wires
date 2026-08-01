#!/usr/bin/env node
import { runInit } from "./commands/init.ts";
import { runSeed } from "./commands/seed.ts";
import { runUnseed } from "./commands/unseed.ts";
import { runStatus } from "./commands/status.ts";
import { runEvents } from "./commands/events.ts";
import { runScope } from "./commands/scope.ts";
import { runResume, runKill } from "./commands/resume.ts";
import { runTest } from "./commands/test.ts";
import { runExempt } from "./commands/exempt.ts";
import { runReplay, runExport } from "./commands/replay.ts";
import { runInstallHook, runUninstallHook } from "./commands/installHook.ts";
import { runMcpCommand } from "./commands/mcpCommand.ts";
import { runSimulate } from "./commands/simulate.ts";

const HELP = `canarywatch — tripwires for AI agents

Usage:
  canarywatch init [workspace]              Seed canaries + print hook setup instructions
  canarywatch seed [workspace] [--density=light|standard|paranoid]
  canarywatch unseed [workspace]            Remove canaries seeded in a workspace
  canarywatch status [workspace]            Show manifest, policy, session, and log health
  canarywatch events [N] [--pending] [--verify]
  canarywatch scope add <path>              Add a directory to this workspace's allowed write scope
  canarywatch scope list
  canarywatch resume <session-id>           Unlock a paused/locked session
  canarywatch kill <session-id>             Lock a session (deny all further tool calls)
  canarywatch exempt <path>                 Grant temporary access exemption for a path
  canarywatch replay <session-id>           Replay session timeline and decisions
  canarywatch export [--session=ID] [--format=json|ocsf] Export event log records
  canarywatch install-hook [--dry-run]     Automatically install Claude Code hook integration
  canarywatch uninstall-hook                Remove Claude Code hook integration
  canarywatch mcp-proxy <cmd> [args...]     Launch an MCP stdio proxy gateway
  canarywatch simulate <tool> [input]       Dry-run policy evaluation on mock tool input
  canarywatch test                          Self-test: verify the tripwire actually fires
`;

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case "init":
      runInit(rest);
      break;
    case "seed":
      runSeed(rest);
      break;
    case "unseed":
      runUnseed(rest);
      break;
    case "status":
      runStatus(rest);
      break;
    case "events":
      runEvents(rest);
      break;
    case "scope":
      runScope(rest);
      break;
    case "resume":
      runResume(rest);
      break;
    case "kill":
      runKill(rest);
      break;
    case "exempt":
      runExempt(rest);
      break;
    case "replay":
      runReplay(rest);
      break;
    case "export":
      runExport(rest);
      break;
    case "install-hook":
      runInstallHook(rest);
      break;
    case "uninstall-hook":
      runUninstallHook();
      break;
    case "mcp-proxy":
      runMcpCommand(rest);
      break;
    case "simulate":
      runSimulate(rest);
      break;
    case "test":
      await runTest();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main();

