import { describe, expect, it } from "vitest";
import {
  assembleTeamPeople,
  computeConfidence,
} from "../../../server/services/company-team-service";

function makeUser(overrides: { id: number; name?: string; role?: string | null; location?: string | null; isActive?: boolean }) {
  return {
    id: overrides.id,
    name: overrides.name ?? `User${overrides.id}`,
    role: overrides.role ?? null,
    location: overrides.location ?? null,
    isActive: overrides.isActive ?? true,
  };
}

describe("assembleTeamPeople (company-team-service pure mapper)", () => {
  it("derives status from isActive (active vs inactive)", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 1, isActive: true }), makeUser({ id: 2, isActive: false })],
      allocationByUser: new Map(),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: false,
    });
    expect(out.find((p) => p.id === 1)!.status).toBe("active");
    expect(out.find((p) => p.id === 2)!.status).toBe("inactive");
  });

  it("passes location through verbatim, normalising undefined to null", () => {
    const out = assembleTeamPeople({
      users: [
        makeUser({ id: 10, location: "Cape Town" }),
        makeUser({ id: 11, location: null }),
      ],
      allocationByUser: new Map(),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: false,
    });
    expect(out.find((p) => p.id === 10)!.location).toBe("Cape Town");
    expect(out.find((p) => p.id === 11)!.location).toBeNull();
  });

  it("returns a real utilisationPct and SUPPRESSES activeWorkItemCount when allocation_pct exists (mutual exclusivity)", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 50 })],
      allocationByUser: new Map([
        [50, { totalAllocation: 80, nonNullAllocCount: 2 }],
      ]),
      activeProjectsByUser: new Map(),
      // 7 open items would normally surface as the proxy, but utilisation
      // is real for this user, so activeWorkItemCount must be null.
      activeWorkItemsByUser: new Map([[50, 7]]),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: true,
    });
    const p = out[0];
    expect(p.utilisationPct).toBe(80);
    expect(p.activeWorkItemCount).toBeNull();
  });

  it("falls back to activeWorkItemCount when no allocation_pct is recorded for the user", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 60 }), makeUser({ id: 61 })],
      allocationByUser: new Map(),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map([[60, 5]]),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: true,
    });
    const sixty = out.find((p) => p.id === 60)!;
    const sixtyOne = out.find((p) => p.id === 61)!;
    expect(sixty.utilisationPct).toBeNull();
    expect(sixty.activeWorkItemCount).toBe(5);
    // user with no items gets 0 (still distinguishable from "no signal at all")
    expect(sixtyOne.activeWorkItemCount).toBe(0);
  });

  it("returns nulls for both utilisation and activeWorkItemCount when neither signal is available globally", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 70 })],
      allocationByUser: new Map(),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: false,
    });
    expect(out[0].utilisationPct).toBeNull();
    expect(out[0].activeWorkItemCount).toBeNull();
  });

  it("counts active projects from the merged set (lead columns + work-item membership)", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 80 }), makeUser({ id: 81 })],
      allocationByUser: new Map(),
      // 80 contributes to 3 distinct active projects, 81 to none.
      activeProjectsByUser: new Map([
        [80, new Set([101, 102, 103])],
      ]),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: true,
      hasAnyActiveWorkItems: false,
    });
    expect(out.find((p) => p.id === 80)!.activeProjectCount).toBe(3);
    expect(out.find((p) => p.id === 81)!.activeProjectCount).toBe(0);
  });

  it("returns activeProjectCount=null when there are no active projects at all (avoids implying real 0)", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 90 })],
      allocationByUser: new Map(),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: false,
    });
    expect(out[0].activeProjectCount).toBeNull();
  });

  it("rounds fractional allocation totals to whole percentages", () => {
    const out = assembleTeamPeople({
      users: [makeUser({ id: 100 })],
      allocationByUser: new Map([
        [100, { totalAllocation: 66.7, nonNullAllocCount: 2 }],
      ]),
      activeProjectsByUser: new Map(),
      activeWorkItemsByUser: new Map(),
      hasAnyActiveProjects: false,
      hasAnyActiveWorkItems: false,
    });
    expect(out[0].utilisationPct).toBe(67);
  });
});

describe("computeConfidence (signal-presence rule)", () => {
  it("returns 'high' only when allocation AND project membership signals exist", () => {
    expect(
      computeConfidence({
        hasAnyAllocationData: true,
        hasAnyProjectMembershipSignals: true,
        hasAnyActiveWorkItems: true,
      }),
    ).toBe("high");
  });

  it("does NOT return 'high' when allocation exists but no user-project signals (architect edge case)", () => {
    // This is the case where active projects exist but nobody is mapped to
    // any of them — the active-project tile would render 0 for everyone,
    // so claiming "high" confidence would be a lie. Must be 'partial'.
    expect(
      computeConfidence({
        hasAnyAllocationData: true,
        hasAnyProjectMembershipSignals: false,
        hasAnyActiveWorkItems: true,
      }),
    ).toBe("partial");
  });

  it("returns 'partial' when exactly one signal is present", () => {
    expect(
      computeConfidence({
        hasAnyAllocationData: true,
        hasAnyProjectMembershipSignals: false,
        hasAnyActiveWorkItems: false,
      }),
    ).toBe("partial");
    expect(
      computeConfidence({
        hasAnyAllocationData: false,
        hasAnyProjectMembershipSignals: true,
        hasAnyActiveWorkItems: false,
      }),
    ).toBe("partial");
    expect(
      computeConfidence({
        hasAnyAllocationData: false,
        hasAnyProjectMembershipSignals: false,
        hasAnyActiveWorkItems: true,
      }),
    ).toBe("partial");
  });

  it("returns 'low' when no signals are present", () => {
    expect(
      computeConfidence({
        hasAnyAllocationData: false,
        hasAnyProjectMembershipSignals: false,
        hasAnyActiveWorkItems: false,
      }),
    ).toBe("low");
  });
});
