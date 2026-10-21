import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractPathClaims } from "../src/hook/pathClaims.ts";

describe("extractPathClaims", () => {
  test("Read -> exact read claim", () => {
    const claims = extractPathClaims("Read", { file_path: "/a/b.txt" });
    assert.deepEqual(claims, [{ path: "/a/b.txt", access: "read", confidence: "exact" }]);
  });

  test("Write -> exact write claim", () => {
    const claims = extractPathClaims("Write", { file_path: "/a/b.txt" });
    assert.deepEqual(claims, [{ path: "/a/b.txt", access: "write", confidence: "exact" }]);
  });

  test("Edit -> exact write claim", () => {
    const claims = extractPathClaims("Edit", { file_path: "/a/b.txt" });
    assert.equal(claims[0].access, "write");
  });

  test("Glob -> list claim combining path + pattern", () => {
    const claims = extractPathClaims("Glob", { path: "/a", pattern: "**/*.env" });
    assert.equal(claims[0].access, "list");
    assert.equal(claims[0].confidence, "glob");
    assert.equal(claims[0].path, "/a/**/*.env");
  });

  test("Grep -> list claim on the search root", () => {
    const claims = extractPathClaims("Grep", { path: "/a", pattern: "TODO" });
    assert.equal(claims[0].access, "list");
    assert.equal(claims[0].path, "/a");
  });

  test("Grep of an existing file is treated as a content read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-grep-"));
    try {
      const file = path.join(dir, ".env");
      fs.writeFileSync(file, "SECRET=x");
      const claims = extractPathClaims("Grep", { path: ".env", pattern: "SECRET" }, dir);
      assert.equal(claims[0].access, "read");
      assert.equal(claims[0].path, ".env");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Grep with no path defaults to cwd marker", () => {
    const claims = extractPathClaims("Grep", { pattern: "TODO" });
    assert.equal(claims[0].path, ".");
  });

  test("Bash delegates to the shell lexer", () => {
    const claims = extractPathClaims("Bash", { command: "cat .env" });
    assert.equal(claims.length, 1);
    assert.equal(claims[0].confidence, "lexed");
  });

  test("unknown tool yields no claims", () => {
    const claims = extractPathClaims("WebFetch", { url: "https://example.com" });
    assert.deepEqual(claims, []);
  });

  test("missing file_path yields no claims rather than throwing", () => {
    assert.deepEqual(extractPathClaims("Read", {}), []);
  });
});
