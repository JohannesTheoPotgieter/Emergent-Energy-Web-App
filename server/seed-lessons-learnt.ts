import { db } from "./db";
import { lessonsLearnt } from "@shared/schema/handover";
import { eq, sql } from "drizzle-orm";

const SEED_LESSONS = [
  {
    title: "Gen Integration Communication Failure — Secunda Pick & Pay",
    description: "When gen integration issues arose with ELIM, the team delayed communicating to the client for multiple weeks. The client became highly frustrated. Lesson: if struggling with a sub-system integration, communicate to the client early and set realistic revised expectations. Do not wait for a solution before disclosing the problem.",
    tags: ["Generator integration", "C&I", "Shopping centre"],
    projectType: "C&I",
    technologyTags: [],
    addedByName: "System Seed",
  },
  {
    title: "Battery Sizing Without Metering Data — Bethal",
    description: "Battery was sized based on a comparable site's consumption because the new development had no metering history. This created uncertainty on whether the sizing was correct. Lesson: always document the sizing assumption basis in the handover, get client written acknowledgement of the risk, and split payment milestones so solar is not blocked by battery uncertainty.",
    tags: ["Battery", "BESS", "Hybrid", "New development"],
    projectType: "BESS",
    technologyTags: ["Battery", "Hybrid"],
    addedByName: "System Seed",
  },
];

export async function seedLessonsLearnt() {
  for (const lesson of SEED_LESSONS) {
    const existing = await db.select({ id: lessonsLearnt.id })
      .from(lessonsLearnt)
      .where(eq(lessonsLearnt.title, lesson.title))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(lessonsLearnt).values(lesson);
      console.log(`[seed] Inserted lesson: ${lesson.title}`);
    } else {
      console.log(`[seed] Lesson already exists: ${lesson.title}`);
    }
  }
}
