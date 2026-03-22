import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, mkdir, copyFile } from "fs/promises";
import crypto from "crypto";
import { execSync } from "child_process";

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
    versionData.lastUpdated = buildTime;
  } catch {}

  const now = new Date();
  const buildNumber = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const versionString = `${versionData.major}.${versionData.minor}.${versionData.patch}`;

  console.log(`Build ID: ${buildId}`);
  console.log(`Version: ${versionString}`);
  console.log(`Build Number: ${buildNumber}`);

  await writeFile("version.json", JSON.stringify(versionData, null, 2));

  let releaseNotes: { title: string; description: string }[] = [];
  try {
    const existingRn = JSON.parse(await readFile("release-notes.json", "utf-8"));
    if (existingRn.notes && existingRn.notes.length > 0 && existingRn.notes[0].description) {
      releaseNotes = existingRn.notes;
      console.log(`Release notes: ${releaseNotes.length} items loaded from release-notes.json`);
    } else {
      throw new Error("No custom release notes");
    }
  } catch {
    try {
      let lastTag = "";
      try {
        lastTag = execSync("git describe --tags --abbrev=0 HEAD^ 2>/dev/null", { encoding: "utf-8" }).trim();
      } catch {}

      const range = lastTag ? `${lastTag}..HEAD` : "HEAD~30..HEAD";
      const log = execSync(`git log ${range} --pretty=format:"%s" --no-merges 2>/dev/null`, { encoding: "utf-8" }).trim();

      if (log) {
        const commits = log.split("\n").filter(Boolean);
        const seen = new Set<string>();
        for (const msg of commits) {
          const cleaned = msg.replace(/^["']|["']$/g, "").trim();
          if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
          if (/^(merge|wip|fix typo|lint|format|chore)/i.test(cleaned)) continue;
          seen.add(cleaned.toLowerCase());
          const title = cleaned.length > 80 ? cleaned.slice(0, 77) + "..." : cleaned;
          releaseNotes.push({ title, description: "" });
        }
      }

      if (releaseNotes.length === 0) {
        releaseNotes.push({ title: "Bug fixes and performance improvements", description: "" });
      }

      console.log(`Release notes: ${releaseNotes.length} items generated from git log`);
    } catch (err) {
      console.log("Could not generate release notes from git, using default");
      releaseNotes = [{ title: "Bug fixes and performance improvements", description: "" }];
    }
  }

  const releaseData = {
    version: versionString,
    buildNumber,
    buildTime,
    notes: releaseNotes,
  };
  await writeFile("release-notes.json", JSON.stringify(releaseData, null, 2));

  console.log("building client...");
  await viteBuild();

  console.log("writing build version...");
  await writeFile("dist/public/build-version.json", JSON.stringify({ buildId, buildTime, version: versionString, buildNumber }));
  await writeFile("dist/public/release-notes.json", JSON.stringify(releaseData));

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

  console.log("copying schema SQL files...");
  await mkdir("dist/script", { recursive: true });
  for (const f of ["pre-push-enums.sql", "full-schema-alignment.sql"]) {
    try {
      await copyFile(`script/${f}`, `dist/script/${f}`);
    } catch {}
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
