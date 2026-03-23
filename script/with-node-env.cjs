const { spawn } = require("node:child_process");

const [, , envValue, command, ...args] = process.argv;

if (!envValue || !command) {
  console.error("Usage: node script/with-node-env.cjs <NODE_ENV> <command> [...args]");
  process.exit(1);
}

const isStrictRuntime = envValue === "production" || envValue === "staging";

const child = spawn(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_ENV: envValue,
    JWT_SECRET: process.env.JWT_SECRET || (isStrictRuntime ? undefined : "local-dev-jwt-secret"),
    SESSION_SECRET: process.env.SESSION_SECRET || (isStrictRuntime ? undefined : "local-dev-session-secret"),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
