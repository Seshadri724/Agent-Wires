// Best-effort extraction of path-shaped tokens from a shell command string.
// Explicitly NOT a shell parser — docs/THREAT-MODEL.md §4 documents this
// as evadable by obfuscation (base64, env indirection, etc). It exists to
// catch the common case (`cat .env`, `rm -rf ~/.ssh`) cheaply; the daemon
// (docs/ROADMAP.md Phase 2) is the real backstop for obfuscated shell.

import type { Access, PathClaim } from "../core/types.ts";

// Commands whose non-flag arguments are typically being *written to* or
// *deleted*, as opposed to merely read/listed.
const WRITE_COMMANDS = new Set(["rm", "mv", "cp", "truncate", "shred", "tee", "chmod", "chown"]);
const DELETE_COMMANDS = new Set(["rm", "shred"]);
const LIST_COMMANDS = new Set(["ls", "find", "stat", "file", "tree"]);
const READ_COMMANDS = new Set(["grep", "rg"]);

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    if (c === "|" || c === ";" || c === "&") {
      if (current.length > 0) tokens.push(current);
      tokens.push(c);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function looksLikePath(token: string): boolean {
  if (token.startsWith("-")) return false; // flag
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false; // VAR=value
  return (
    token.includes("/") ||
    token.includes("\\") ||
    token.startsWith("~") ||
    token.startsWith(".") ||
    /\.[A-Za-z0-9]{1,5}$/.test(token) // has a file-extension-like suffix
  );
}

/**
 * Split a compound command (`a && b | c`) into simple commands and
 * extract PathClaims per simple command. Confidence is always "lexed".
 */
export function extractBashPathClaims(command: string): PathClaim[] {
  const tokens = tokenize(command);
  const claims: PathClaim[] = [];

  let segment: string[] = [];
  const flushSegment = () => {
    if (segment.length === 0) return;
    claims.push(...claimsForSegment(segment));
    segment = [];
  };

  for (const t of tokens) {
    if (t === "|" || t === ";" || t === "&") {
      flushSegment();
      continue;
    }
    segment.push(t);
  }
  flushSegment();

  return claims;
}

function claimsForSegment(segment: string[]): PathClaim[] {
  const [cmd, ...args] = segment;
  // shortcut: recognizes curl @-uploads only; extend when another upload syntax is supported.
  const isCurl = /(?:^|[\\/])curl(?:\.exe)?$/i.test(cmd);
  const uploadPaths = isCurl ? args.flatMap((arg) => {
    const match = /(?:^|=)@(.+)/.exec(arg);
    const uploadedPath = match?.[1].split(";")[0];
    return uploadedPath ? [uploadedPath] : [];
  }) : [];
  const pathArgs = args.filter((arg) => !(isCurl && /(?:^|=)@/.test(arg)) && looksLikePath(arg));
  if (pathArgs.length === 0 && uploadPaths.length === 0) return [];

  let access: Access = "read";
  if (DELETE_COMMANDS.has(cmd)) access = "delete";
  else if (WRITE_COMMANDS.has(cmd)) access = "write";
  else if (LIST_COMMANDS.has(cmd)) access = "list";
  else if (READ_COMMANDS.has(cmd)) access = "read";

  // Redirection targets (`> file`, `>> file`) are always writes,
  // regardless of the command being run.
  const claims: PathClaim[] = [];
  const raw = segment.join(" ");
  const redirectMatches = raw.matchAll(/>>?\s*([^\s|;&]+)/g);
  const redirectTargets = new Set<string>();
  for (const m of redirectMatches) {
    redirectTargets.add(m[1]);
    claims.push({ path: m[1], access: "write", confidence: "lexed" });
  }

  for (const p of pathArgs) {
    if (redirectTargets.has(p)) continue;
    claims.push({ path: p, access, confidence: "lexed" });
  }
  for (const p of uploadPaths) claims.push({ path: p, access: "read", confidence: "lexed" });

  return claims;
}
