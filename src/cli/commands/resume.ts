import { loadSession, resumeSession, saveSession } from "../../core/session.ts";

export function runResume(args: string[]): void {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: canarywatch resume <session-id>");
    process.exitCode = 1;
    return;
  }
  resumeSession(sessionId);
  console.log(`Session ${sessionId} resumed. Tool calls will be allowed again.`);
}

export function runKill(args: string[]): void {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: canarywatch kill <session-id>");
    process.exitCode = 1;
    return;
  }
  const state = loadSession(sessionId);
  state.locked = true;
  saveSession(state);
  console.log(`Session ${sessionId} locked. All further tool calls will be denied until \`canarywatch resume\`.`);
}
