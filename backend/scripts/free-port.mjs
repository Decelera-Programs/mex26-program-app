import { exec } from "node:child_process";

function run(command) {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (error, stdout) => {
      resolve({ error, stdout: String(stdout || "") });
    });
  });
}

async function killPortOnWindows(port) {
  const { stdout } = await run(`netstat -ano -p tcp | findstr :${port}`);
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes("LISTENING"));

  const pids = [...new Set(lines.map((line) => line.split(/\s+/).at(-1)).filter(Boolean))];
  for (const pid of pids) {
    await run(`taskkill /PID ${pid} /F`);
  }
}

async function killPortOnUnix(port) {
  const { stdout } = await run(`lsof -ti tcp:${port}`);
  const pids = [...new Set(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  for (const pid of pids) {
    await run(`kill -9 ${pid}`);
  }
}

async function main() {
  const port = process.argv[2] || "8787";
  if (process.platform === "win32") {
    await killPortOnWindows(port);
    return;
  }
  await killPortOnUnix(port);
}

main().catch(() => {
  // No-op: this helper should never block server startup.
});
