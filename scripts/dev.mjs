#!/usr/bin/env node
// Root dev orchestrator: runs the local GPU worker dev server (port 8000)
// alongside the web app (vite). Kills both on exit / when either dies.
import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["--filter", "@openreel/agent-runner", "dev:worker"], { stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@openreel/web", "dev"], { stdio: "inherit" }),
];

let shuttingDown = false;

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev] a dev process exited (code ${code}); stopping the rest.`);
      shutdown(code ?? 0);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));