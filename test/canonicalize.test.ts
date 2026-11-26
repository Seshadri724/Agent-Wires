import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalize, expandHome, globMatch } from "../src/core/canonicalize.ts";

describe("expandHome", () => {
  test("expands bare ~", () => {
    assert.equal(expandHome("~"), os.homedir());
  });

  test("expands ~/subpath", () => {
    assert.equal(expandHome("~/foo/bar"), path.join(os.homedir(), "foo", "bar"));
  });

  test("leaves absolute paths untouched", () => {
    const abs = path.resolve(os.tmpdir());
    assert.equal(expandHome(abs), abs);
  });
});

describe("canonicalize", () => {
  test("relative and absolute forms of the same existing file match", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canon-"));
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "x");

    const viaAbsolute = canonicalize(file);
    const viaRelative = canonicalize("a.txt", dir);
    assert.equal(viaAbsolute, viaRelative);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("nonexistent path still canonicalizes deterministically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canon-"));
    const p1 = canonicalize(path.join(dir, "does-not-exist.txt"));
    const p2 = canonicalize("does-not-exist.txt", dir);
    assert.equal(p1, p2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("relative paths with spaces and parent traversal resolve to the same file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canon-space-"));
    const workspace = path.join(dir, "workspace with spaces");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "secret file.txt"), "x");
    try {
      assert.equal(
        canonicalize("../secret file.txt", path.join(workspace, "nested")),
        canonicalize(path.join(workspace, "secret file.txt"))
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("existing symlink and target canonicalize identically", (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canon-link-"));
    const target = path.join(dir, "target.txt");
    const alias = path.join(dir, "alias.txt");
    fs.writeFileSync(target, "x");
    try {
      try {
        fs.symlinkSync(target, alias);
      } catch (error) {
        t.skip(`symlinks unavailable in this environment: ${error}`);
        return;
      }
      assert.equal(canonicalize(alias), canonicalize(target));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("trailing separator is stripped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-canon-"));
    const withSlash = canonicalize(dir + path.sep);
    const withoutSlash = canonicalize(dir);
    assert.equal(withSlash, withoutSlash);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("globMatch", () => {
  test("** matches any depth", () => {
    assert.ok(globMatch("**/.env", "/home/user/project/.env"));
    assert.ok(globMatch("**/.env", "/.env"));
  });

  test("* matches within a single segment only", () => {
    assert.ok(globMatch("**/.env.*", "/proj/.env.local"));
    assert.ok(!globMatch("**/.env.*", "/proj/.env/nested"));
  });

  test("exact segment match required outside wildcards", () => {
    assert.ok(globMatch("**/.ssh/**", "/home/user/.ssh/id_rsa"));
    assert.ok(!globMatch("**/.ssh/**", "/home/user/.sshsomething/id_rsa"));
  });
});
