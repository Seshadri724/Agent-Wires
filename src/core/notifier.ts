// Cross-platform desktop notifications, no npm dependency.
// docs/ARCHITECTURE.md §3.4 "Response Orchestrator" — Notifier.
// docs/ROADMAP.md Phase 1 checkpoint item 4 ("Pause & review UX ... fire a
// desktop notification"); docs/DEVELOPMENT.md previously tracked this as
// "not yet" (stderr-only stand-in in src/hook/hook.ts).
//
// SECURITY: `message`/`title` here ultimately derive from a Decision.reason,
// which embeds path claims extracted from an agent's tool input — i.e.
// attacker-influenced text (see docs/THREAT-MODEL.md §6 trust boundary).
// Every platform branch below either (a) passes argv directly to spawn
// with no shell involved (Linux: notify-send — safest, no escaping needed)
// or (b) builds a small embedded script and escapes the string literal
// boundary for that specific interpreter (Windows PowerShell single-quoted
// strings, macOS AppleScript double-quoted strings) before interpolating.
// Never build a shell command line via string concatenation and run it
// through a shell — that's the injection vector this avoids.
//
// Fire-and-forget: spawned detached + unref'd, so a slow or hung notifier
// process never adds latency to the hook's permission decision.

import { spawn } from "node:child_process";

const MAX_LEN = 300;

export function sanitize(s: string): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, MAX_LEN);
}

function fireAndForget(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", () => {
      // Binary not found (e.g. no notify-send installed) — silently drop.
      // A missing notifier must never surface as a hook failure.
    });
    child.unref();
  } catch {
    // Never let a notification failure affect the caller.
  }
}

export function escapePowerShellSingleQuoted(s: string): string {
  return s.replace(/'/g, "''");
}

export function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notifyWindows(title: string, message: string): void {
  const t = escapePowerShellSingleQuoted(title);
  const m = escapePowerShellSingleQuoted(message);
  // System.Windows.Forms.NotifyIcon balloon tip: works out of the box on
  // any Windows PowerShell without registering an AppUserModelID (unlike
  // the WinRT toast API, which silently fails without one). The spawned
  // process holds itself open just long enough to show the balloon, then
  // exits — fine since it's detached from the hook's own lifetime.
  const script =
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
    "$n = New-Object System.Windows.Forms.NotifyIcon; " +
    "$n.Icon = [System.Drawing.SystemIcons]::Warning; " +
    "$n.Visible = $true; " +
    `$n.BalloonTipTitle = '${t}'; ` +
    `$n.BalloonTipText = '${m}'; ` +
    "$n.ShowBalloonTip(6000); " +
    "Start-Sleep -Seconds 7; " +
    "$n.Dispose()";
  fireAndForget("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script]);
}

function notifyMac(title: string, message: string): void {
  const t = escapeAppleScriptString(title);
  const m = escapeAppleScriptString(message);
  const script = `display notification "${m}" with title "${t}"`;
  fireAndForget("osascript", ["-e", script]);
}

function notifyLinux(title: string, message: string): void {
  // No shell involved — argv items are passed verbatim, so no escaping
  // is needed regardless of content (this is the safest of the three).
  fireAndForget("notify-send", ["--urgency=critical", title, message]);
}

export function sendDesktopNotification(title: string, message: string): void {
  const t = sanitize(title);
  const m = sanitize(message);
  switch (process.platform) {
    case "win32":
      notifyWindows(t, m);
      break;
    case "darwin":
      notifyMac(t, m);
      break;
    default:
      notifyLinux(t, m);
      break;
  }
}
