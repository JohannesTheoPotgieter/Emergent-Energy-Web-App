import { spawn } from 'node:child_process';

const command = process.argv.slice(2).join(' ').trim();
if (!command) {
  console.error('Usage: tsx script/run-with-app.ts <command>');
  process.exit(2);
}

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5000';
const HEALTH_PATH = process.env.APP_HEALTH_PATH || '/api/health';
const HEALTH_URL = `${APP_URL}${HEALTH_PATH}`;
const START_TIMEOUT_MS = Number(process.env.APP_START_TIMEOUT_MS || 120_000);
const POLL_MS = Number(process.env.APP_POLL_MS || 1_000);

const appEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || '5000',
  API_URL: process.env.API_URL || APP_URL,
  SESSION_SECRET: process.env.SESSION_SECRET || 'test-session-secret',
  ENABLE_STARTUP_MAINTENANCE: process.env.ENABLE_STARTUP_MAINTENANCE || 'false',
  ENABLE_STARTUP_SCHEMA_REPAIR: process.env.ENABLE_STARTUP_SCHEMA_REPAIR || 'false',
  ENABLE_STARTUP_DATA_SEED: process.env.ENABLE_STARTUP_DATA_SEED || 'false',
  ENABLE_STARTUP_BACKFILL: process.env.ENABLE_STARTUP_BACKFILL || 'false',
  ENABLE_STARTUP_SESSION_RESET: process.env.ENABLE_STARTUP_SESSION_RESET || 'false',
  ENABLE_STARTUP_USER_SEED: process.env.ENABLE_STARTUP_USER_SEED || 'false',
};

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy()) return true;
    await wait(POLL_MS);
  }
  return false;
}

let appProcess: ReturnType<typeof spawn> | null = null;
let startedByScript = false;

if (!(await isHealthy())) {
  startedByScript = true;
  console.log(`Starting app server for command: ${command}`);
  appProcess = spawn('npm', ['run', 'dev'], {
    env: appEnv,
    stdio: 'inherit',
    shell: true,
  });

  const healthy = await waitForHealth(START_TIMEOUT_MS);
  if (!healthy) {
    console.error(`Server failed to become healthy at ${HEALTH_URL} within ${START_TIMEOUT_MS}ms`);
    if (appProcess && !appProcess.killed) {
      appProcess.kill('SIGTERM');
    }
    process.exit(1);
  }
  console.log(`Server is healthy at ${HEALTH_URL}`);
}

const testProcess = spawn(command, {
  env: appEnv,
  stdio: 'inherit',
  shell: true,
});

const testExitCode: number = await new Promise((resolve) => {
  testProcess.on('exit', (code) => resolve(code ?? 1));
});

if (startedByScript && appProcess && !appProcess.killed) {
  appProcess.kill('SIGTERM');
}

process.exit(testExitCode);
