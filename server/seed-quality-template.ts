import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  qcTemplate,
  qcTemplatePhase,
  qcTemplateGroup,
  qcTemplateItem,
  qcTemplateRiskQuestion,
  qcTemplatePostmortemMetric,
  calendarHoliday,
} from "@shared/schema";

export async function seedQualityTemplate() {
  const existing = await db.select().from(qcTemplate).where(eq(qcTemplate.name, "Project Checklist Template V1"));
  if (existing.length > 0) {
    console.log("[Seed] Quality template already exists, skipping.");
    return;
  }

  console.log("[Seed] Seeding Quality Checklist Template V1...");

  const [template] = await db.insert(qcTemplate).values({
    name: "Project Checklist Template V1",
    version: 1,
    isActive: true,
  }).returning();

  const phases = [
    { phaseKey: "planning_design", phaseName: "Planning & Design", sortOrder: 0 },
    { phaseKey: "construction", phaseName: "Construction", sortOrder: 1 },
    { phaseKey: "commissioning", phaseName: "Commissioning", sortOrder: 2 },
    { phaseKey: "handover", phaseName: "Handover", sortOrder: 3 },
  ];

  const insertedPhases: Record<string, number> = {};
  for (const p of phases) {
    const [phase] = await db.insert(qcTemplatePhase).values({
      templateId: template.id,
      phaseKey: p.phaseKey,
      phaseName: p.phaseName,
      sortOrder: p.sortOrder,
    }).returning();
    insertedPhases[p.phaseKey] = phase.id;
  }

  const groupsData: Record<string, { groupName: string; sortOrder: number; items: { itemName: string; isEvidenceRequired?: boolean }[] }[]> = {
    planning_design: [
      {
        groupName: "PVSol", sortOrder: 0,
        items: [
          { itemName: "Shading correct" },
          { itemName: "Positioning correct" },
          { itemName: "Modules as per tracker" },
          { itemName: "Stringing optimal" },
          { itemName: "PV strings paths defined on modules" },
          { itemName: "Techsitter targets P90 done?" },
        ],
      },
      {
        groupName: "Site inspections", sortOrder: 1,
        items: [
          { itemName: "Inspection report done", isEvidenceRequired: true },
          { itemName: "Clear view on execution" },
          { itemName: "All info acquired for SSEG" },
          { itemName: "SSEG SLD created", isEvidenceRequired: true },
          { itemName: "Roof drone images uploaded & reviewed", isEvidenceRequired: true },
        ],
      },
    ],
    construction: [
      {
        groupName: "Quality checks", sortOrder: 0,
        items: [
          { itemName: "Engineering pack timeline" },
          { itemName: "Legend information correct" },
          { itemName: "SDP showing relevant information as per site inspection" },
          { itemName: "Module layout & dimensions correct" },
          { itemName: "Cable trays designed as per SANS and adequate routes" },
          { itemName: "Earthing/Bonding according to SANS" },
          { itemName: "DC SLD as per PVSol & string layout", isEvidenceRequired: true },
          { itemName: "AC SLD according to site OEM, info, SANS & Eskom/Munic req.", isEvidenceRequired: true },
          { itemName: "DB GA drawing and SLD match up", isEvidenceRequired: true },
          { itemName: "GA according to site info and OEM specifications/requirements (If applicable)", isEvidenceRequired: true },
          { itemName: "Aesthetics of EP acceptable" },
          { itemName: "Index and pages correlate (Version and page numbers)" },
          { itemName: "Subcontractor Roof entry report inspected", isEvidenceRequired: true },
        ],
      },
    ],
    commissioning: [
      {
        groupName: "Form preparation", sortOrder: 0,
        items: [
          { itemName: "Timeline" },
          { itemName: "Site info correct" },
          { itemName: "Test page set up correctly" },
          { itemName: "Communication correct as per portal, SLD" },
        ],
      },
      {
        groupName: "Site activities", sortOrder: 1,
        items: [
          { itemName: "Commissioning successful" },
          { itemName: "Portal showing inverters as per EP" },
          { itemName: "Capacity test reached" },
          { itemName: "RTI conducted and reviewed", isEvidenceRequired: true },
          { itemName: "CoC concluded and reviewed", isEvidenceRequired: true },
          { itemName: "Q&A list uploaded with clear directive", isEvidenceRequired: true },
        ],
      },
    ],
    handover: [
      {
        groupName: "Document completions", sortOrder: 0,
        items: [
          { itemName: "Timeline" },
          { itemName: "As-built PVSol design in folder", isEvidenceRequired: true },
          { itemName: "Techsitter targets in folder", isEvidenceRequired: true },
          { itemName: "As-built EP signed and in folder", isEvidenceRequired: true },
          { itemName: "Entry report in folder", isEvidenceRequired: true },
          { itemName: "Exit report in folder", isEvidenceRequired: true },
          { itemName: "Snag rectifications approved", isEvidenceRequired: true },
          { itemName: "Techsitter report approved", isEvidenceRequired: true },
          { itemName: "Inspection report approved", isEvidenceRequired: true },
          { itemName: "Testing report approved", isEvidenceRequired: true },
          { itemName: "CoC in folder", isEvidenceRequired: true },
          { itemName: "PR engineer sign off in folder", isEvidenceRequired: true },
        ],
      },
    ],
  };

  for (const [phaseKey, groups] of Object.entries(groupsData)) {
    const phaseId = insertedPhases[phaseKey];
    for (const g of groups) {
      const [group] = await db.insert(qcTemplateGroup).values({
        templatePhaseId: phaseId,
        groupName: g.groupName,
        sortOrder: g.sortOrder,
      }).returning();

      for (let i = 0; i < g.items.length; i++) {
        await db.insert(qcTemplateItem).values({
          templateGroupId: group.id,
          itemName: g.items[i].itemName,
          sortOrder: i,
          isEvidenceRequired: g.items[i].isEvidenceRequired ?? false,
          defaultSeverity: "Medium",
        });
      }
    }
  }

  const riskQuestionsData: Record<string, { questionText: string; responseType: string; triggersWarning: boolean; triggerCondition?: string; triggerSeverity?: string }[]> = {
    planning_design: [
      { questionText: "If shading was incorrect, does this impact P90?", responseType: "yesno", triggersWarning: true, triggerCondition: "yes", triggerSeverity: "High" },
      { questionText: "If yes, by how much is it impacted? (%)", responseType: "number", triggersWarning: false },
      { questionText: "Can the roof sheets be easily damaged", responseType: "yesno", triggersWarning: true, triggerCondition: "yes", triggerSeverity: "Medium" },
      { questionText: "Steps to be taken if roof can be damaged", responseType: "text", triggersWarning: false },
      { questionText: "Has cooling been considered?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
    ],
    construction: [
      { questionText: "Is the AC route length as per costing sheet?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
      { questionText: "If no, how much of a difference is there?", responseType: "number", triggersWarning: false },
      { questionText: "Is the DC route length as per costing sheet?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
      { questionText: "If no, how much of a difference is there?", responseType: "number", triggersWarning: false },
      { questionText: "Is there a tenant metering system in place?", responseType: "yesno", triggersWarning: true, triggerCondition: "yes", triggerSeverity: "High" },
    ],
    commissioning: [
      { questionText: "Has the project followed the install schedule?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
      { questionText: "If no, what is the delay caused?", responseType: "text", triggersWarning: false },
      { questionText: "Has the initial setups been done correctly?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "High" },
      { questionText: "If no, what is the delay caused?", responseType: "text", triggersWarning: false },
      { questionText: "Have the CT's been placed in the right place and direction?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "High" },
      { questionText: "Is the meter giving the correct information?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "High" },
    ],
    handover: [
      { questionText: "Has the pre-admin work been done correctly?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
      { questionText: "If no, what is the delay caused?", responseType: "text", triggersWarning: false },
      { questionText: "Has the IV curve testing been done correctly?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "High" },
      { questionText: "If no, what is the delay caused?", responseType: "text", triggersWarning: false },
      { questionText: "Have the snags been uploaded timeously (RTI incl)?", responseType: "yesno", triggersWarning: true, triggerCondition: "no", triggerSeverity: "Medium" },
      { questionText: "If no, what is the delay caused?", responseType: "text", triggersWarning: false },
    ],
  };

  for (const [phaseKey, questions] of Object.entries(riskQuestionsData)) {
    const phaseId = insertedPhases[phaseKey];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await db.insert(qcTemplateRiskQuestion).values({
        templatePhaseId: phaseId,
        questionText: q.questionText,
        sortOrder: i,
        responseType: q.responseType,
        triggersWarning: q.triggersWarning,
        triggerCondition: q.triggerCondition ?? null,
        triggerSeverity: q.triggerSeverity ?? null,
      });
    }
  }

  const postmortemMetrics = [
    { name: "Commissioning pass rate", inputType: "choice", metricGroup: "contractor_quality", scoringRuleJson: { choices: { "1": 1, "2": 0.5, "3": 0.33 }, description: "1=first pass, 2=second, 3=third+" } },
    { name: "Snag count", inputType: "count", metricGroup: "contractor_quality", scoringRuleJson: { formula: "(100-(count*10))/100", description: "Score decreases 10% per snag" } },
    { name: "Snag completion MTTR (days)", inputType: "count", metricGroup: "contractor_quality", scoringRuleJson: { formula: "(100-(days*12.5))/100", description: "Score decreases 12.5% per day" } },
    { name: "Pre-engineering - PVSol (count)", inputType: "count", metricGroup: "engineering_quality", scoringRuleJson: { formula: "(100-(count*15))/100", description: "Score decreases 15% per revision" } },
    { name: "Engineering Pack revisions (count)", inputType: "count", metricGroup: "engineering_quality", scoringRuleJson: { formula: "(100-(count*15))/100", description: "Score decreases 15% per revision" } },
    { name: "Construction challenges (count)", inputType: "count", metricGroup: "engineering_quality", scoringRuleJson: { formula: "(100-(count*15))/100", description: "Score decreases 15% per challenge" } },
    { name: "Time to complete EP (days)", inputType: "count", metricGroup: "engineering_quality", scoringRuleJson: { formula: "(100-(days*2.5))/100", description: "Score decreases 2.5% per day" } },
  ];

  for (const m of postmortemMetrics) {
    await db.insert(qcTemplatePostmortemMetric).values({
      name: m.name,
      inputType: m.inputType,
      metricGroup: m.metricGroup,
      scoringRuleJson: m.scoringRuleJson,
    });
  }

  console.log("[Seed] Quality template seeded successfully.");

  await seedZAHolidays();
}

async function seedZAHolidays() {
  const existingHolidays = await db.select().from(calendarHoliday).where(eq(calendarHoliday.countryCode, "ZA"));
  if (existingHolidays.length > 0) {
    console.log("[Seed] ZA holidays already exist, skipping.");
    return;
  }

  console.log("[Seed] Seeding ZA public holidays 2025-2026...");

  const holidays = [
    { date: "2025-01-01", name: "New Year's Day" },
    { date: "2025-03-21", name: "Human Rights Day" },
    { date: "2025-04-18", name: "Good Friday" },
    { date: "2025-04-21", name: "Family Day" },
    { date: "2025-04-28", name: "Freedom Day (observed)" },
    { date: "2025-05-01", name: "Workers' Day" },
    { date: "2025-06-16", name: "Youth Day" },
    { date: "2025-08-09", name: "National Women's Day" },
    { date: "2025-09-24", name: "Heritage Day" },
    { date: "2025-12-16", name: "Day of Reconciliation" },
    { date: "2025-12-25", name: "Christmas Day" },
    { date: "2025-12-26", name: "Day of Goodwill" },
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-02", name: "New Year's Day (observed)" },
    { date: "2026-03-21", name: "Human Rights Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Family Day" },
    { date: "2026-05-01", name: "Workers' Day" },
    { date: "2026-06-16", name: "Youth Day" },
    { date: "2026-08-09", name: "National Women's Day" },
    { date: "2026-08-10", name: "National Women's Day (observed)" },
    { date: "2026-09-24", name: "Heritage Day" },
    { date: "2026-12-16", name: "Day of Reconciliation" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "Day of Goodwill" },
  ];

  await db.insert(calendarHoliday).values(
    holidays.map((h) => ({ ...h, countryCode: "ZA" }))
  );

  console.log("[Seed] ZA holidays seeded successfully.");
}
