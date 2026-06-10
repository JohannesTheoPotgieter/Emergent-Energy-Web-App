import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // drizzle-kit push/pull default to schemaFilter ["public"], which silently
  // ignores the pgSchema("core") tables (departments, role_definitions) that
  // shared/schema declares — so push-managed DBs (CI quality-gate, dev
  // db:push) diverged from migrate-managed DBs. db:verify-schema flagged
  // exactly this; list every app schema so push and migrate produce the same
  // schema. generate/migrate are unaffected by this option.
  schemaFilter: ["public", "core"],
});
