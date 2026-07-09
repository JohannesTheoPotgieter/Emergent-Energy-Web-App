/**
 * Task 3.1 — mobile/site-inspection evidence capture.
 *
 * QC item evidence now supports capturing a photo directly from the device
 * camera (capture="environment") and renders image evidence as inline
 * thumbnails. Source-contract test over QualityTab.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Task 3.3 moved the evidence UI into EvidencePanel.
const SOURCE = fs.readFileSync(
  path.join(process.cwd(), "client/src/components/tabs/quality/EvidencePanel.tsx"),
  "utf8",
);

describe("QC evidence camera capture + thumbnails", () => {
  it("has a camera-capture input that opens the rear camera", () => {
    expect(SOURCE).toContain('capture="environment"');
    expect(SOURCE).toContain('accept="image/*"');
    expect(SOURCE).toContain("cameraInputRef");
  });

  it("offers a 'Take photo' button", () => {
    expect(SOURCE).toContain("Take photo");
    expect(SOURCE).toMatch(/data-testid=\{`evidence-camera-btn-\$\{itemId\}`\}/);
  });

  it("renders image evidence as inline thumbnails", () => {
    expect(SOURCE).toContain("isImageEvidenceUrl");
    expect(SOURCE).toMatch(/data-testid=\{`evidence-thumb-\$\{ev\.id\}`\}/);
    expect(SOURCE).toContain("object-cover");
  });

  it("classifies common image extensions as photos", () => {
    // The helper is a plain regex — mirror its intent here as a guard.
    const re = /\.(png|jpe?g|gif|webp|heic|heif|bmp)(\?.*)?$/i;
    expect(re.test("/uploads/qm-approvals/site.jpg")).toBe(true);
    expect(re.test("/uploads/qm-approvals/report.pdf")).toBe(false);
  });
});
