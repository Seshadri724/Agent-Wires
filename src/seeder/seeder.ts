// Seeds/unseeds canary decoys into a workspace and registers them in the
// signed manifest. docs/PRD.md R1-R6.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  addManifestEntry,
  buildManifestPathSet,
  generateToken,
  loadManifest,
  loadOrCreateKey,
  removeManifestEntriesForWorkspace,
  saveManifest,
} from "../core/manifest.ts";
import { canonicalize, isSubpathOrEqual } from "../core/canonicalize.ts";
import { templatesForDensity } from "./templates.ts";
import type { ManifestEntry } from "../core/types.ts";

export type Density = "light" | "standard" | "paranoid";

export interface SeedResult {
  seeded: ManifestEntry[];
  skipped: string[]; // paths that already existed as real files — never overwritten
}

export interface UnseedResult {
  removed: ManifestEntry[];
  preservedModified: ManifestEntry[];
}

const GITIGNORE_MARKER = "# local secrets — do not commit";
const LEGACY_GITIGNORE_MARKER = "# canarywatch decoys — do not remove (managed by `canarywatch seed`)";

export function seed(workspaceRoot: string, density: Density = "standard"): SeedResult {
  const root = canonicalize(workspaceRoot);
  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const templates = templatesForDensity(density);

  const seeded: ManifestEntry[] = [];
  const skipped: string[] = [];
  const gitignoreLines: string[] = [];

  for (const tpl of templates) {
    const target = path.join(root, tpl.relativePath);
    if (fs.existsSync(target)) {
      skipped.push(target); // R5: never overwrite an existing real file
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tokenId = generateToken();
    const text = tpl.render(tokenId);
    fs.writeFileSync(target, text, { mode: 0o600 });
    const entry = addManifestEntry(manifest, key, target, root, Buffer.from(text), tokenId);
    seeded.push(entry);
    gitignoreLines.push("/" + tpl.relativePath.replace(/\\/g, "/"));
  }

  saveManifest(manifest);
  updateGitignore(root, gitignoreLines);

  return { seeded, skipped };
}

export function unseed(workspaceRoot: string): UnseedResult {
  const root = canonicalize(workspaceRoot);
  const manifest = loadManifest();
  const key = loadOrCreateKey();
  buildManifestPathSet(manifest, key); // refuse destructive work on a tampered registry
  const entries = removeManifestEntriesForWorkspace(manifest, root);
  for (const entry of entries) {
    if (!isSubpathOrEqual(root, entry.path)) {
      throw new Error(`Refusing to unseed a path outside the workspace: ${entry.path}`);
    }
  }
  // Persist registry removal before deleting files. If persistence fails,
  // leave every file untouched so the old manifest remains authoritative.
  saveManifest(manifest);

  const removed: ManifestEntry[] = [];
  const preservedModified: ManifestEntry[] = [];
  for (const entry of entries) {
    try {
      if (!fs.existsSync(entry.path)) continue;
      const actualHash = crypto.createHash("sha256").update(fs.readFileSync(entry.path)).digest("hex");
      if (actualHash !== entry.sha256) {
        preservedModified.push(entry);
        continue;
      }
      fs.unlinkSync(entry.path);
      removed.push(entry);
    } catch {
      preservedModified.push(entry);
    }
  }
  removeGitignoreEntries(root, removed.map((e) => "/" + path.relative(root, e.path).replace(/\\/g, "/")));
  return { removed, preservedModified };
}

function updateGitignore(root: string, lines: string[]): void {
  if (lines.length === 0) return;
  const gi = path.join(root, ".gitignore");
  let existing = "";
  if (fs.existsSync(gi)) existing = fs.readFileSync(gi, "utf8");
  const linesInFile = existing.split("\n");
  const markerIndex = linesInFile.findIndex((line) => line.trim() === GITIGNORE_MARKER);
  if (markerIndex !== -1) {
    const missing = lines.filter((line) => !linesInFile.some((existingLine) => existingLine.trim() === line));
    if (missing.length > 0) {
      linesInFile.splice(markerIndex + 1, 0, ...missing);
      fs.writeFileSync(gi, linesInFile.join("\n"));
    }
    return;
  }
  const block = "\n" + GITIGNORE_MARKER + "\n" + lines.join("\n") + "\n";
  fs.writeFileSync(gi, existing + block);
}

function removeGitignoreEntries(root: string, removedPaths: string[]): void {
  const gi = path.join(root, ".gitignore");
  if (!fs.existsSync(gi) || removedPaths.length === 0) return;
  const lines = fs.readFileSync(gi, "utf8").split("\n");
  const markerIndex = lines.findIndex((line) => [GITIGNORE_MARKER, LEGACY_GITIGNORE_MARKER].includes(line.trim()));
  if (markerIndex === -1) return;
  const removeSet = new Set(removedPaths);
  const rest = lines.slice(markerIndex + 1).filter((line) => !removeSet.has(line.trim()));
  if (rest.every((line) => line.trim() === "")) lines.splice(markerIndex, lines.length - markerIndex);
  else lines.splice(markerIndex + 1, lines.length - markerIndex - 1, ...rest);
  fs.writeFileSync(gi, lines.join("\n"));
}
