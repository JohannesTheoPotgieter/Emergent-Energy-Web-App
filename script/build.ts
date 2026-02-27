import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";
import crypto from "crypto";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  const buildId = crypto.randomUUID();
  const buildTime = new Date().toISOString();

  let versionData = { major: 0, minor: 0, patch: 1, lastUpdated: buildTime };
  try {
    versionData = JSON.parse(await readFile("version.json", "utf-8"));
    versionData.patch += 1;
    versionData.lastUpdated = buildTime;
  } catch {}

  const now = new Date();
  const buildNumber = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const versionString = `${versionData.major}.${versionData.minor}.${String(versionData.patch).padStart(3, "0")}`;

  console.log(`Build ID: ${buildId}`);
  console.log(`Version: ${versionString}`);
  console.log(`Build Number: ${buildNumber}`);

  await writeFile("version.json", JSON.stringify(versionData, null, 2));

  console.log("building client...");
  await viteBuild();

  console.log("writing build version...");
  await writeFile("dist/public/build-version.json", JSON.stringify({ buildId, buildTime, version: versionString, buildNumber }));

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
