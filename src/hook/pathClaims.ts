// Maps tool call inputs (Claude Code native + MCP generic tools) to PathClaims.
// docs/ARCHITECTURE.md §3.2, §4.2.

import { extractBashPathClaims } from "./shellLex.ts";
import fs from "node:fs";
import path from "node:path";
import type { Access, PathClaim } from "../core/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolInput = Record<string, any>;

export function extractPathClaims(toolName: string, input: ToolInput, cwd = process.cwd()): PathClaim[] {
  if (!input || typeof input !== "object") return [];

  // 1. Exact Claude Code harness tool matches
  switch (toolName) {
    case "Read":
      return input.file_path ? [{ path: String(input.file_path), access: "read", confidence: "exact" }] : [];

    case "Write":
      return input.file_path ? [{ path: String(input.file_path), access: "write", confidence: "exact" }] : [];

    case "Edit":
    case "NotebookEdit":
      return input.file_path ? [{ path: String(input.file_path), access: "write", confidence: "exact" }] : [];

    case "Glob":
      return input.pattern
        ? [{ path: joinPathAndPattern(input.path, input.pattern), access: "list", confidence: "glob" }]
        : [];

    case "Grep": {
      const target = input.path ?? ".";
      const targetPath = String(target);
      // Grep reads file contents. Treat a concrete existing file as a read
      // so exact canaries and sensitive files cannot be searched around.
      // Directory searches remain broad/list claims to avoid blocking normal
      // repository-wide searches.
      let access: Access = "list";
      try {
        if (fs.statSync(path.resolve(cwd, targetPath)).isFile()) access = "read";
      } catch {
        // Unknown, globbed, or not-yet-existing search roots remain list claims.
      }
      return [{ path: targetPath, access, confidence: "glob" }];
    }

    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : undefined;
      return cmd ? extractBashPathClaims(cmd) : [];
    }
  }

  // 2. Generic / MCP tool claim extraction (e.g. filesystem.read_file, write_file, exec, etc.)
  const normalizedTool = toolName.toLowerCase();

  // Bash/exec-like MCP tools
  if (/bash|exec|shell|terminal|run_command|execute/i.test(normalizedTool)) {
    const cmd = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : undefined;
    if (cmd) return extractBashPathClaims(cmd);
  }

  // Determine path value from common path keys in tool input
  const pathVal = input.file_path ?? input.path ?? input.filePath ?? input.target ?? input.uri ?? input.filename ?? input.file;
  if (!pathVal || typeof pathVal !== "string") return [];

  // Determine access intent from normalized tool name
  let access: Access = "read";
  if (/delete|remove|unlink|rm/i.test(normalizedTool)) {
    access = "delete";
  } else if (/write|edit|create|save|modify|update|append/i.test(normalizedTool)) {
    access = "write";
  } else if (/list|dir|glob|grep|search|find/i.test(normalizedTool)) {
    access = "list";
  } else if (/read|view|cat|get|fetch|show/i.test(normalizedTool)) {
    access = "read";
  }

  return [{ path: pathVal, access, confidence: "exact" }];
}

function joinPathAndPattern(basePath: string | undefined, pattern: string): string {
  if (!basePath) return pattern;
  return String(basePath).replace(/[\\/]+$/, "") + "/" + pattern;
}
