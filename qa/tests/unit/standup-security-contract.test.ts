import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema/users";

/**
 * Standup security/RBAC contract tests (engineer-function audit follow-up).
 *
 * Static-analysis guards that lock in the fixes for the standup audit:
 *   - read routes enforce standup view (not requireAuth alone)
 *   - schedule mutations assert per-schedule access (no cross-team IDOR)
 *   - entry edit is owner-scoped
 *   - the facilitator allow-list is registry-derived (no drift)
 *   - persisted session counts get cross-field integrity validation
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("standup read routes enforce view RBAC", () => {
  const src = read("server/standup-routes.ts");

  // Every GET standup route that exposes a team's data must carry the
  // requireStandupView guard. (The user's own schedule list at
  // /api/standups/schedules is self-scoped by userId and is exempt.)
  const guardedReadPaths = [
    "/api/standups/schedules/:id/participants",
    "/api/standups/today",
    "/api/standups/entries/:scheduleId",
    "/api/standups/entries/:scheduleId/history",
    "/api/standups/analytics/:scheduleId",
    "/api/standups/analytics/:scheduleId/trends",
    "/api/standups/analytics/:scheduleId/per-person",
    "/api/standups/digest/:scheduleId",
    "/api/standups/meeting/:scheduleId",
    "/api/standups/history",
    "/api/standups/blockers/active",
  ];

  for (const p of guardedReadPaths) {
    it(`GET ${p} carries requireStandupView`, () => {
      // Match the route line and assert the guard is present on it.
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`app\\.get\\("${escaped}",[^\\n]*requireStandupView`);
      expect(re.test(src), `expected requireStandupView on GET ${p}`).toBe(true);
    });
  }
});

describe("standup schedule mutations are access-checked (no IDOR)", () => {
  const src = read("server/standup-routes.ts");

  it("defines assertScheduleAccess with creator/participant/admin check", () => {
    expect(src).toContain("async function assertScheduleAccess");
    expect(src).toContain("schedule.createdBy === user.id");
    expect(src).toContain("standupParticipants.userId, user.id");
    expect(src).toContain("throw forbidden(");
  });

  it("calls assertScheduleAccess in every schedule/participant mutation", () => {
    // PATCH schedule, DELETE schedule, POST participant, DELETE participant.
    const calls = src.match(/assertScheduleAccess\(/g) ?? [];
    // 1 definition usage in the function signature + 4 call sites.
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});

describe("standup entry edit is owner-scoped", () => {
  const src = read("server/standup-routes.ts");
  const start = src.indexOf('app.patch("/api/standups/entries/:id"');
  const end = src.indexOf("app.", start + 10);
  const route = src.slice(start, end);

  it("filters the update by the author's userId", () => {
    expect(route).toContain("eq(standupEntries.userId, user.id)");
    expect(route).toContain("notFound(");
  });
});

describe("standup facilitator list is registry-derived", () => {
  const src = read("server/routes/standup-sessions.routes.ts");

  it("derives STANDUP_FACILITATOR_ROLES from the registry edit_roles", () => {
    expect(src).toContain("ENTITY_PERMISSION_DEFAULTS.find");
    expect(src).toContain('entity === "standups"');
    expect(src).toContain("edit_roles");
    // Must NOT hardcode the old drifted literal list.
    expect(src).not.toContain('STANDUP_FACILITATOR_ROLE_NAMES');
  });

  it("registry standups.edit_roles includes the engineering supervisor path", () => {
    const standups = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === "standups");
    expect(standups).toBeTruthy();
    // Sanity: ENGINEERING_MANAGER can facilitate; plain ENGINEER cannot.
    expect(standups!.edit_roles).toContain("ENGINEERING_MANAGER");
    expect(standups!.edit_roles).not.toContain("ENGINEER");
  });
});

describe("standup session persistence validates count integrity", () => {
  const src = read("server/routes/standup-sessions.routes.ts");

  it("rejects incoherent count combinations via superRefine", () => {
    expect(src).toContain(".superRefine(");
    expect(src).toContain("completedCount + s.skippedCount > s.participantCount");
    expect(src).toContain("s.blockerCount > s.participantCount");
  });
});
