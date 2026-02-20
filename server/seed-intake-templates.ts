import { db } from "./db";
import { intakeTaskTemplates } from "@shared/schema";

export async function seedIntakeTaskTemplates() {
  const existing = await db.select().from(intakeTaskTemplates);
  if (existing.length > 0) {
    console.log(`[Seed] Intake task templates already present (${existing.length}), skipping.`);
    return;
  }

  const templates = [
    {
      requestType: "First Assessment",
      title: "Gather tariff + metering data",
      description: "Collect tariff schedules and metering data from client or log blocker if unavailable",
      dodItems: ["Tariff schedule obtained", "Metering data reviewed", "Blockers logged if applicable"],
      sortOrder: 1,
    },
    {
      requestType: "First Assessment",
      title: "Confirm working schedule + access constraints",
      description: "Document site working schedule and any access constraints",
      dodItems: ["Working schedule documented", "Access constraints noted", "Client confirmation received"],
      sortOrder: 2,
    },
    {
      requestType: "First Assessment",
      title: "Capture site constraints",
      description: "Document roof/space limitations, genset requirements, BESS needs, etc.",
      dodItems: ["Roof/space assessment done", "Genset integration needs captured", "BESS requirements noted", "Other constraints documented"],
      sortOrder: 3,
    },
    {
      requestType: "First Assessment",
      title: "Preliminary layout + yield model",
      description: "Create initial PV layout and energy yield model",
      dodItems: ["Layout drawing completed", "Yield model run", "Results documented"],
      sortOrder: 4,
    },
    {
      requestType: "First Assessment",
      title: "Risks + assumptions section",
      description: "Document all risks and assumptions for the assessment",
      dodItems: ["Risk register completed", "Assumptions listed", "Mitigation strategies noted"],
      sortOrder: 5,
    },
    {
      requestType: "First Assessment",
      title: "Internal QA review",
      description: "QA review by Tanaka or designated reviewer",
      dodItems: ["QA review completed", "Feedback addressed", "Sign-off received"],
      sortOrder: 6,
    },
    {
      requestType: "First Assessment",
      title: "Issue FA to PD + store links",
      description: "Issue First Assessment pack to Project Developer and store document links",
      dodItems: ["FA pack compiled", "Issued to PD", "Links stored in app/SharePoint"],
      sortOrder: 7,
    },
    {
      requestType: "Cost Proposal",
      title: "Lock design basis",
      description: "Finalize and lock the design basis document",
      dodItems: ["Design basis reviewed", "All parameters confirmed", "Document locked"],
      sortOrder: 1,
    },
    {
      requestType: "Cost Proposal",
      title: "PV*SOL/Helioscope outputs stored",
      description: "Run simulations and store outputs",
      dodItems: ["Simulation completed", "Output files stored", "Results reviewed"],
      sortOrder: 2,
    },
    {
      requestType: "Cost Proposal",
      title: "BOM + costing aligned to EE template",
      description: "Create Bill of Materials and costing using EE standard template",
      dodItems: ["BOM completed", "Pricing verified", "Aligned to EE template format"],
      sortOrder: 3,
    },
    {
      requestType: "Cost Proposal",
      title: "Assumptions/exclusions documented",
      description: "Document all assumptions and exclusions clearly",
      dodItems: ["Assumptions listed", "Exclusions documented", "Client-facing language reviewed"],
      sortOrder: 4,
    },
    {
      requestType: "Cost Proposal",
      title: "QA gate (Tanaka + Dean)",
      description: "Quality gate review by senior engineers",
      dodItems: ["Tanaka review completed", "Dean review completed (if required)", "All comments resolved"],
      sortOrder: 5,
    },
    {
      requestType: "Cost Proposal",
      title: "Issue CP pack to PD + store link",
      description: "Issue Cost Proposal pack and await signed CP",
      dodItems: ["CP document compiled", "Issued to PD", "Link stored", "Awaiting signed CP"],
      sortOrder: 6,
    },
    {
      requestType: "Site Visit Report",
      title: "Schedule site visit",
      description: "Coordinate and schedule the site visit with relevant parties",
      dodItems: ["Date confirmed", "Team assigned", "Client notified", "Travel arranged"],
      sortOrder: 1,
    },
    {
      requestType: "Site Visit Report",
      title: "Capture photos/measurements/constraints",
      description: "On-site data collection including photos and measurements",
      dodItems: ["Photos captured", "Measurements taken", "Constraints documented", "GPS recorded"],
      sortOrder: 2,
    },
    {
      requestType: "Site Visit Report",
      title: "Upload inspection form",
      description: "Complete and upload the site inspection form",
      dodItems: ["Form completed", "Photos attached", "Form uploaded to system"],
      sortOrder: 3,
    },
    {
      requestType: "Site Visit Report",
      title: "Issue report + close",
      description: "Compile site visit report and close the request",
      dodItems: ["Report compiled", "Issued to stakeholders", "Request closed"],
      sortOrder: 4,
    },
    {
      requestType: "Meter Installation",
      title: "Confirm requirements + utility contact",
      description: "Confirm meter requirements and establish utility contact",
      dodItems: ["Requirements confirmed", "Utility contact established", "Specifications documented"],
      sortOrder: 1,
    },
    {
      requestType: "Meter Installation",
      title: "Schedule installation",
      description: "Schedule the meter installation with all parties",
      dodItems: ["Date confirmed", "Installer assigned", "Client notified"],
      sortOrder: 2,
    },
    {
      requestType: "Meter Installation",
      title: "Verify monitoring/data",
      description: "Verify meter is reporting data correctly after installation",
      dodItems: ["Meter online", "Data verified", "Monitoring confirmed"],
      sortOrder: 3,
    },
    {
      requestType: "Meter Installation",
      title: "Close with evidence",
      description: "Close the request with installation evidence",
      dodItems: ["Installation photos", "Test readings documented", "Client sign-off"],
      sortOrder: 4,
    },
    {
      requestType: "Data Analysis Request",
      title: "Collect dataset",
      description: "Gather all required data for the analysis",
      dodItems: ["Data sources identified", "Data collected", "Data quality checked"],
      sortOrder: 1,
    },
    {
      requestType: "Data Analysis Request",
      title: "Run analysis + recommendation note",
      description: "Perform analysis and prepare recommendation note",
      dodItems: ["Analysis completed", "Findings documented", "Recommendation note drafted"],
      sortOrder: 2,
    },
    {
      requestType: "Data Analysis Request",
      title: "Review with senior engineer",
      description: "Get review from senior engineering team member",
      dodItems: ["Review meeting held", "Feedback incorporated", "Sign-off received"],
      sortOrder: 3,
    },
    {
      requestType: "Data Analysis Request",
      title: "Issue output",
      description: "Issue the analysis output to the requestor",
      dodItems: ["Output document finalized", "Issued to requestor", "Request closed"],
      sortOrder: 4,
    },
    {
      requestType: "Sizing Rational Request",
      title: "Review meter/load profile",
      description: "Review metering data and load profile",
      dodItems: ["Meter data reviewed", "Load profile analyzed", "Peak demand identified"],
      sortOrder: 1,
    },
    {
      requestType: "Sizing Rational Request",
      title: "Recommend sizing + limits",
      description: "Provide sizing recommendation with technical limits",
      dodItems: ["Sizing calculation completed", "Technical limits documented", "Recommendation prepared"],
      sortOrder: 2,
    },
    {
      requestType: "Sizing Rational Request",
      title: "Issue updated FA output",
      description: "Issue updated First Assessment output with sizing rationale",
      dodItems: ["FA output updated", "Sizing rationale included", "Document issued"],
      sortOrder: 3,
    },
  ];

  for (const tmpl of templates) {
    await db.insert(intakeTaskTemplates).values(tmpl);
  }
  console.log(`[Seed] Created ${templates.length} intake task templates`);
}
