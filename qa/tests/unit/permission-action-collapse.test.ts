import { describe, it, expect } from "vitest";
import { collapseEntityPermissions } from "../../../server/bootstrap/backfills/permission-action-collapse-backfill";

describe("collapseEntityPermissions (view|edit model)", () => {
  it("folds any mutating action into edit and keeps view", () => {
    const { collapsed } = collapseEntityPermissions({
      cos: { view: true, create: false, edit: false, approve: true, override: false, delete: false },
    });
    // approve was granted → edit; edit implies view.
    expect(collapsed.cos).toEqual({ view: true, edit: true });
  });

  it("treats a pure view grant as View (no edit)", () => {
    const { collapsed } = collapseEntityPermissions({
      revenue: { view: true, create: false, edit: false, approve: false, override: false, delete: false },
    });
    expect(collapsed.revenue).toEqual({ view: true, edit: false });
  });

  it("edit implies view even if view was not explicitly set", () => {
    const { collapsed } = collapseEntityPermissions({
      projects: { edit: true },
    });
    expect(collapsed.projects).toEqual({ view: true, edit: true });
  });

  it("preserves an explicit deny (all false → No access)", () => {
    const { collapsed } = collapseEntityPermissions({
      admin: { view: false, create: false, edit: false, approve: false, override: false, delete: false },
    });
    expect(collapsed.admin).toEqual({ view: false, edit: false });
  });

  it("folds delete/override grants into edit", () => {
    const { collapsed } = collapseEntityPermissions({
      a: { view: true, delete: true },
      b: { override: true },
    });
    expect(collapsed.a).toEqual({ view: true, edit: true });
    expect(collapsed.b).toEqual({ view: true, edit: true });
  });

  it("preserves meta (underscore-prefixed) keys verbatim", () => {
    const meta = { foo: true } as any;
    const { collapsed } = collapseEntityPermissions({ _meta: meta, cos: { view: true } });
    expect(collapsed._meta).toBe(meta);
    expect(collapsed.cos).toEqual({ view: true, edit: false });
  });

  it("is idempotent on already-collapsed data (changed=false)", () => {
    const already = { cos: { view: true, edit: true }, revenue: { view: true, edit: false } };
    const { collapsed, changed } = collapseEntityPermissions(already);
    expect(changed).toBe(false);
    expect(collapsed).toEqual(already);
  });

  it("flags changed=true when shape collapses", () => {
    const { changed } = collapseEntityPermissions({
      cos: { view: true, approve: true },
    });
    expect(changed).toBe(true);
  });

  it("handles null / empty input", () => {
    expect(collapseEntityPermissions(null)).toEqual({ collapsed: {}, changed: false });
    expect(collapseEntityPermissions(undefined)).toEqual({ collapsed: {}, changed: false });
    expect(collapseEntityPermissions({})).toEqual({ collapsed: {}, changed: false });
  });
});
