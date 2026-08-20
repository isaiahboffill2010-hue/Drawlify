import { spawn } from "node:child_process";

const vite = spawn("npm", ["run", "dev:renderer"], {
  stdio: "inherit",
  shell: true
});

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting until the dev server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

const stop = () => {
  if (!vite.killed) {
    vite.kill();
  }
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await waitForServer("http://127.0.0.1:5173");

const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
  }
});

electron.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
