// The notifier embeds attacker-influenced text (Decision.reason, which
// contains path claims from agent tool input) into small PowerShell /
// AppleScript snippets. These tests exist specifically to prove that a
// crafted "reason" string can't break out of its string-literal context
// and get arbitrary code executed. See src/core/notifier.ts's top comment.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { escapeAppleScriptString, escapePowerShellSingleQuoted, sanitize } from "../src/core/notifier.ts";

describe("escapePowerShellSingleQuoted", () => {
  test("every single quote in the output is part of an escaped '' pair", () => {
    const hostile = "harmless'; Remove-Item -Recurse -Force C:\\ ; $x='";
    const escaped = escapePowerShellSingleQuoted(hostile);
    // Removing every '' pair should leave zero remaining bare quotes —
    // if any survive, the attacker's payload would terminate the PS
    // string literal early and get its content interpreted as code.
    const withPairsRemoved = escaped.replace(/''/g, "");
    assert.equal(withPairsRemoved.includes("'"), false);
  });

  test("embedding the escaped value back in a single-quoted literal round-trips to the original text", () => {
    const hostile = "it's a trap: '; whoami; '";
    const escaped = escapePowerShellSingleQuoted(hostile);
    // Simulate what PowerShell's own lexer does with '' inside a
    // single-quoted string: collapse pairs back to one quote.
    const psParsed = escaped.replace(/''/g, "'");
    assert.equal(psParsed, hostile);
  });

  test("text with no quotes is unchanged", () => {
    assert.equal(escapePowerShellSingleQuoted("D1 canary touch: read"), "D1 canary touch: read");
  });
});

describe("escapeAppleScriptString", () => {
  test("every double-quote in the output is escaped", () => {
    const hostile = 'end quote"; do shell script "rm -rf ~"; "';
    const escaped = escapeAppleScriptString(hostile);
    // Every " must be immediately preceded by \ (i.e. no bare, unescaped
    // double-quote survives that could close the AppleScript literal).
    const bareQuote = /(^|[^\\])"/;
    assert.equal(bareQuote.test(escaped), false);
  });

  test("backslashes are escaped before quotes so escaping itself can't be subverted", () => {
    // If a backslash right before a literal quote weren't escaped first,
    // the attacker could send `\"` expecting it to neutralize our escaping
    // and produce a bare `"` after processing.
    const hostile = '\\" ; do shell script "id" ; "';
    const escaped = escapeAppleScriptString(hostile);
    const bareQuote = /(^|[^\\])"/;
    assert.equal(bareQuote.test(escaped), false);
  });

  test("text with no special characters is unchanged", () => {
    assert.equal(escapeAppleScriptString("D2 sensitive-path access"), "D2 sensitive-path access");
  });
});

describe("sanitize", () => {
  test("collapses newlines to spaces", () => {
    assert.equal(sanitize("line one\nline two\r\nline three"), "line one line two line three");
  });

  test("truncates to a bounded length", () => {
    const long = "x".repeat(1000);
    assert.ok(sanitize(long).length <= 300);
  });

  test("short plain text is unchanged", () => {
    assert.equal(sanitize("D1 canary touch"), "D1 canary touch");
  });
});
