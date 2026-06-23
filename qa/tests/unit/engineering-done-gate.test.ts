import { describe, it, expect } from "vitest";
import { assertTaskWorkflowTransition, type TaskWorkflowContext } from "../../../server/lib/task-workflow-guard";
import {
  requiresDocumentLink,
  DOCUMENT_OUTPUT_TASK_TYPE_TAGS,
  ENGINEERING_DELIVERY_TASK_TYPE_TAGS,
  isEngineeringTaskTypeTag,
  isSeamTaskTypeTag,
} from "@shared/engineering/delivery-task-catalog";

const baseContext = (overrides: Partial<TaskWorkflowContext> = {}): TaskWorkflowContext => ({
  taskId: 1,
  currentStatus: "IN PROGRESS",
  approvalRequired: false,
  deliverableRequired: false,
  deliverableSent: false,
  ...overrides,
});

const DONE_GATE_MESSAGE = "This task can't be marked done until a document is linked.";

describe("engineering delivery task catalog", () => {
  it("flags exactly the document-output tags as requiring a linked document", () => {
    for (const tag of DOCUMENT_OUTPUT_TASK_TYPE_TAGS) {
      expect(requiresDocumentLink(tag), `${tag} requires a doc`).toBe(true);
    }
    const nonOutput = ENGINEERING_DELIVERY_TASK_TYPE_TAGS.filter(
      (t) => !(DOCUMENT_OUTPUT_TASK_TYPE_TAGS as readonly string[]).includes(t),
    );
    for (const tag of nonOutput) {
      expect(requiresDocumentLink(tag), `${tag} does not require a doc`).toBe(false);
    }
    expect(requiresDocumentLink(null)).toBe(false);
    expect(requiresDocumentLink("something_else")).toBe(false);
  });

  it("recognises controlled delivery + seam tags", () => {
    expect(isEngineeringTaskTypeTag("ifc_pack")).toBe(true);
    expect(isEngineeringTaskTypeTag("compliance_input")).toBe(true);
    expect(isEngineeringTaskTypeTag("nope")).toBe(false);
    expect(isSeamTaskTypeTag("construction_snag")).toBe(true);
    expect(isSeamTaskTypeTag("ifc_pack")).toBe(false);
  });
});

describe("Done-gate — no Done without a linked document", () => {
  it("blocks Complete for a document-output task with no linked document", () => {
    const ctx = baseContext({ documentLinkRequired: true, documentLinked: false });
    expect(() => assertTaskWorkflowTransition(ctx, "COMPLETE", "status_update")).toThrow(DONE_GATE_MESSAGE);
    expect(() => assertTaskWorkflowTransition(ctx, "DONE", "bulk_status_update")).toThrow(DONE_GATE_MESSAGE);
  });

  it("allows Complete once a document is linked", () => {
    const ctx = baseContext({ documentLinkRequired: true, documentLinked: true });
    expect(() => assertTaskWorkflowTransition(ctx, "COMPLETE", "status_update")).not.toThrow();
  });

  it("does not gate non-document-output tasks", () => {
    const ctx = baseContext({ documentLinkRequired: false, documentLinked: false });
    expect(() => assertTaskWorkflowTransition(ctx, "COMPLETE", "status_update")).not.toThrow();
  });

  it("only gates the move to Done, not other transitions", () => {
    const ctx = baseContext({ documentLinkRequired: true, documentLinked: false });
    expect(() => assertTaskWorkflowTransition(ctx, "IN PROGRESS", "status_update")).not.toThrow();
  });
});
