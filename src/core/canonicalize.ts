// Path canonicalization. See docs/ARCHITECTURE.md §3.2 and
// docs/RESOURCES.md "Path canonicalization pitfalls".
//
// Goal: two different spellings of the same file (relative vs absolute,
// mixed slashes, different case on Windows, trailing slash) must
// canonicalize to the same string so manifest lookups are exact-match O(1).

import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const isWindows = process.platform === "win32";

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Canonicalize a path for manifest/policy comparison.
 * - Expands ~
 * - Resolves relative paths against `cwd`
 * - Resolves symlinks and real casing via fs.realpathSync when the path exists
 * - Falls back to path.resolve/normalize when the path does not exist
 *   (canaries may have already been deleted; policy still needs to match)
 * - Case-folds on Windows (NTFS is case-insensitive by default)
 */
export function canonicalize(inputPath: string, cwd: string = process.cwd()): string {
  let p = expandHome(inputPath);
  p = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  p = path.normalize(p);

  try {
    p = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    // Path doesn't exist (yet, or anymore) — normalize what we have.
    // Still resolve as much of the parent chain as exists, so a deleted
    // canary still canonicalizes identically to its manifest entry.
    p = resolveExistingPrefix(p);
  }

  if (isWindows) {
    p = p.toLowerCase();
  }
  // Strip trailing separators (but keep root, e.g. "C:\" or "/").
  if (p.length > 1 && (p.endsWith(path.sep))) {
    p = p.slice(0, -1);
  }
  return p;
}

function resolveExistingPrefix(p: string): string {
  // Built via path.join (not manual string concatenation) so a
  // root-relative Windows path like "\workspace" (no drive letter)
  // resolves to "\workspace", not "\\workspace" — the latter looks like
  // a malformed UNC path and risks a slow/hanging network-name-resolution
  // attempt instead of a fast local ENOENT.
  const root = path.parse(p).root || path.sep;
  const rest = p.slice(root.length).split(path.sep).filter(Boolean);
  let resolved = root;
  for (let i = 0; i < rest.length; i++) {
    const candidate = path.join(resolved, rest[i]);
    try {
      resolved = fs.realpathSync.native ? fs.realpathSync.native(candidate) : fs.realpathSync(candidate);
    } catch {
      return path.normalize(path.join(resolved, ...rest.slice(i)));
    }
  }
  return resolved;
}

/** Minimal glob-ish matcher: supports ** and * segments. No dependency. */
export function globMatch(pattern: string, candidate: string): boolean {
  const normPattern = expandHome(pattern).split(/[\\/]/).filter(Boolean);
  const normCandidate = candidate.split(/[\\/]/).filter(Boolean);

  function match(pi: number, ci: number): boolean {
    if (pi === normPattern.length) return ci === normCandidate.length;
    const seg = normPattern[pi];
    if (seg === "**") {
      if (pi === normPattern.length - 1) return true; // trailing ** matches rest
      for (let k = ci; k <= normCandidate.length; k++) {
        if (match(pi + 1, k)) return true;
      }
      return false;
    }
    if (ci === normCandidate.length) return false;
    if (segMatch(seg, normCandidate[ci])) return match(pi + 1, ci + 1);
    return false;
  }

  function segMatch(pattern: string, value: string): boolean {
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "$",
      isWindows ? "i" : ""
    );
    return re.test(value);
  }

  return match(0, 0);
}

/** Check if child path is equal to or a subpath of parent directory, respecting path boundaries. */
export function isSubpathOrEqual(parentPath: string, childPath: string): boolean {
  const normParent = canonicalize(parentPath);
  const normChild = canonicalize(childPath);
  if (normParent === normChild) return true;
  const parentPrefix = normParent.endsWith(path.sep) ? normParent : normParent + path.sep;
  const parentAltPrefix = normParent.endsWith("/") || normParent.endsWith("\\") ? normParent : normParent + "/";
  return normChild.startsWith(parentPrefix) || normChild.startsWith(parentAltPrefix);
}

