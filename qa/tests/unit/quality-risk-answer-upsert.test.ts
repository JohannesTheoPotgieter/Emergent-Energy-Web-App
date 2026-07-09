/**
 * Task 1.4 — answer un-seeded risk questions.
 *
 * The risk-answer route required an existing `riskAnswerId`, and the client
 * only rendered the editor when an answer row already existed — so a
 * template question with no seeded `qc_risk_answer` was permanently
 * unanswerable. The route now upserts by (checklistId, templateRiskQuestionId)
 * and the client renders an editable control when no answer exists.
 *
 *   - Behavioural: the pure answer-normalisation helper (shared by both the
 *     by-id and upsert paths) preserves the exact mapping.
 *   - Source-anchored: the route supports the upsert path (validation refine,
 *     find-or-create under an advisory lock) and the client submits the
 *     template question id when no answer row exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRiskAnswerUpdates } from "../../../server/lib/quality-risk-answer";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("buildRiskAnswerUpdates — answer normalisation", () => {
  it("passes an explicit boolean answerYesno through", () => {
    expect(buildRiskAnswerUpdates({ answerYesno: true })).toEqual({ answerYesno: true });
    expect(buildRiskAnswerUpdates({ answerYesno: false })).toEqual({ answerYesno: false });
    expect(buildRiskAnswerUpdates({ answerYesno: null })).toEqual({ answerYesno: null });
  });

  it("maps answerValue yes/no to a boolean when answerYesno is absent", () => {
    expect(buildRiskAnswerUpdates({ answerValue: "yes" }).answerYesno).toBe(true);
    expect(buildRiskAnswerUpdates({ answerValue: "no" }).answerYesno).toBe(false);
    expect(buildRiskAnswerUpdates({ answerValue: "unanswered" }).answerYesno).toBeNull();
  });

  it("falls back from answerText to notes", () => {
    expect(buildRiskAnswerUpdates({ answerText: "explicit" }).answerText).toBe("explicit");
    expect(buildRiskAnswerUpdates({ notes: "from notes" }).answerText).toBe("from notes");
    // answerText wins when both present.
    expect(buildRiskAnswerUpdates({ answerText: "wins", notes: "loses" }).answerText).toBe("wins");
  });

  it("emits answerNumber only when provided", () => {
    expect(buildRiskAnswerUpdates({ answerNumber: 42 })).toHaveProperty("answerNumber", 42);
    expect("answerNumber" in buildRiskAnswerUpdates({ answerText: "x" })).toBe(false);
  });

  it("a number-only update does not accidentally set answerText", () => {
    const updates = buildRiskAnswerUpdates({ answerNumber: 7 });
    expect("answerText" in updates).toBe(false);
  });
});

describe("risk-answer route — upsert path (Task 1.4)", () => {
  const server = read("server/quality-routes.ts");

  it("the schema accepts either riskAnswerId or (checklistId, templateRiskQuestionId)", () => {
    expect(server).toMatch(/riskAnswerId:\s*z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
    expect(server).toContain("templateRiskQuestionId: z.number().int().positive().optional()");
    expect(server).toContain("data.riskAnswerId != null || (data.checklistId != null && data.templateRiskQuestionId != null)");
  });

  it("verifies the risk question belongs to the checklist's template", () => {
    expect(server).toContain("risk_question_not_in_template");
  });

  it("upserts under an advisory lock keyed on (checklistId, questionId)", () => {
    expect(server).toContain("qc_risk_answer:${checklistId}:${templateRiskQuestionId}");
    expect(server).toContain(".insert(qcRiskAnswer)");
  });

  it("still recomputes warnings after the answer is written", () => {
    // The handler body around the risk-answer write must recalc warnings.
    const idx = server.indexOf('"/api/quality/project/:projectName/risk-answer"');
    const block = server.slice(idx, idx + 6000);
    // Task 2.2 renamed the call to the observable, awaited helper.
    expect(block).toContain("recomputeWarningsObservable(pName)");
  });
});

describe("RiskQuestionsPanel — risk editor renders without a seeded answer", () => {
  // Task 3.3 moved the risk editor into RiskQuestionsPanel.
  const client = read("client/src/components/tabs/quality/RiskQuestionsPanel.tsx");

  it("submits the template question id when no answer row exists", () => {
    expect(client).toContain("templateRiskQuestionId: rq.id, updates");
  });

  it("no longer gates the editor on the presence of an answer row", () => {
    // Previously `canEdit && answer &&`; now the editor renders on canEdit and
    // reads the answer optionally.
    expect(client).not.toContain("{canEdit && answer && (");
    expect(client).toContain("value={formatRiskYesNo(answer?.answerYesno)}");
  });
});
