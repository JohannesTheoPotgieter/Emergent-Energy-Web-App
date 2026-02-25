function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, credentials: "include" });
}

interface StageExportData {
  stage: any;
  tasks: any[];
  deliverableTemplates: any[];
  uploadedDeliverables: any[];
  approvals: any[];
}

function buildStageSummaryHtml(data: StageExportData, projectName: string): string {
  const { stage, tasks, uploadedDeliverables, approvals } = data;
  const completedTasks = tasks.filter(t => t.status === "complete").length;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${stage.templateName} - ${projectName}</title>
<style>
body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 10px; }
h2 { color: #16213e; margin-top: 20px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
.complete { background: #dcfce7; color: #166534; }
.pending { background: #f3f4f6; color: #374151; }
.approved { background: #dcfce7; color: #166534; }
.rejected { background: #fecaca; color: #991b1b; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; }
th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; }
th { background: #f9fafb; }
.raci { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.raci-item { padding: 6px; background: #f0f9ff; border-radius: 4px; font-size: 13px; }
</style></head><body>
<h1>${stage.templateName}</h1>
<p><strong>Project:</strong> ${projectName}</p>
<p><strong>Status:</strong> <span class="badge ${stage.status === 'complete' ? 'complete' : 'pending'}">${stage.status}</span></p>
<p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
${stage.overrideReason ? `<p><strong>Override:</strong> ${stage.overrideReason}</p>` : ""}

<h2>Purpose</h2>
<p>${stage.templatePurpose || "N/A"}</p>

${stage.templateInputs?.length ? `<h2>Inputs</h2><ul>${stage.templateInputs.map((i: string) => `<li>${i}</li>`).join("")}</ul>` : ""}

<h2>RACI</h2>
<div class="raci">
<div class="raci-item"><strong>Responsible:</strong> ${stage.raciResponsible || "N/A"}</div>
<div class="raci-item"><strong>Accountable:</strong> ${stage.raciAccountable || "N/A"}</div>
<div class="raci-item"><strong>Consulted:</strong> ${stage.raciConsulted || "N/A"}</div>
<div class="raci-item"><strong>Informed:</strong> ${stage.raciInformed || "N/A"}</div>
</div>

<h2>Tasks (${completedTasks}/${tasks.length})</h2>
<table>
<tr><th>#</th><th>Task</th><th>Status</th><th>Notes</th></tr>
${tasks.map(t => `<tr>
<td>${t.sequence}</td>
<td>${t.templateTitle}${!t.isRequired ? " (optional)" : ""}</td>
<td><span class="badge ${t.status === 'complete' ? 'complete' : 'pending'}">${t.status}</span></td>
<td>${t.notes || ""}</td>
</tr>`).join("")}
</table>

<h2>Deliverables (${uploadedDeliverables.length})</h2>
<table>
<tr><th>File</th><th>Version</th><th>Notes</th></tr>
${uploadedDeliverables.length ? uploadedDeliverables.map((d: any) => `<tr>
<td>${d.fileName}</td>
<td>${d.versionTag || ""}</td>
<td>${d.notes || ""}</td>
</tr>`).join("") : "<tr><td colspan='3'>No files uploaded</td></tr>"}
</table>

${approvals.length ? `<h2>Approvals</h2>
<table>
<tr><th>Role</th><th>Status</th><th>Comments</th></tr>
${approvals.map((a: any) => `<tr>
<td>${a.approverRole === "QA_REVIEW" ? "QA Review (Dean)" : "Technical Signoff (Tanaka)"}</td>
<td><span class="badge ${a.status}">${a.status}</span></td>
<td>${a.comments || ""}</td>
</tr>`).join("")}
</table>` : ""}

${stage.failureModes?.length ? `<h2>Failure Modes</h2><ul>${stage.failureModes.map((f: string) => `<li>${f}</li>`).join("")}</ul>` : ""}

</body></html>`;
}

function buildStageSummaryJson(data: StageExportData, projectName: string): string {
  return JSON.stringify({
    project: projectName,
    exportedAt: new Date().toISOString(),
    stage: {
      name: data.stage.templateName,
      status: data.stage.status,
      purpose: data.stage.templatePurpose,
      raci: {
        responsible: data.stage.raciResponsible,
        accountable: data.stage.raciAccountable,
        consulted: data.stage.raciConsulted,
        informed: data.stage.raciInformed,
      },
    },
    tasks: data.tasks.map(t => ({
      sequence: t.sequence,
      title: t.templateTitle,
      status: t.status,
      required: t.isRequired,
      notes: t.notes,
    })),
    deliverables: data.uploadedDeliverables.map((d: any) => ({
      fileName: d.fileName,
      version: d.versionTag,
      notes: d.notes,
    })),
    approvals: data.approvals.map((a: any) => ({
      role: a.approverRole,
      status: a.status,
      comments: a.comments,
    })),
  }, null, 2);
}

async function fetchStageData(stageId: number, projectId: number): Promise<StageExportData> {
  const res = await engFetch(`/api/projects/${projectId}/eng-stages/${stageId}`);
  if (!res.ok) throw new Error("Failed to fetch stage data");
  return res.json();
}

async function downloadDeliverableBlob(id: number): Promise<{ blob: Blob; fileName: string }> {
  const res = await engFetch(`/api/eng-stages/deliverables/${id}/download`);
  if (!res.ok) throw new Error("Failed to download deliverable");
  const cd = res.headers.get("content-disposition");
  const fileName = cd?.match(/filename="(.+)"/)?.[1] || `deliverable_${id}`;
  return { blob: await res.blob(), fileName };
}

function padStageNumber(sortOrder: number): string {
  return String(sortOrder).padStart(2, "0");
}

async function exportViaFSA(data: StageExportData, projectName: string, dirHandle: FileSystemDirectoryHandle) {
  const stageFolderName = `${padStageNumber(data.stage.templateSortOrder || 1)}_${data.stage.templateName.replace(/\s+/g, "_")}`;
  const projDir = await dirHandle.getDirectoryHandle(projectName.replace(/[/\\]/g, "_"), { create: true });
  const engDir = await projDir.getDirectoryHandle("Engineering", { create: true });
  const stageDir = await engDir.getDirectoryHandle(stageFolderName, { create: true });

  const htmlFile = await stageDir.getFileHandle("stage_summary.html", { create: true });
  const htmlWritable = await (htmlFile as any).createWritable();
  await htmlWritable.write(buildStageSummaryHtml(data, projectName));
  await htmlWritable.close();

  const jsonFile = await stageDir.getFileHandle("stage_summary.json", { create: true });
  const jsonWritable = await (jsonFile as any).createWritable();
  await jsonWritable.write(buildStageSummaryJson(data, projectName));
  await jsonWritable.close();

  for (const del of data.uploadedDeliverables) {
    try {
      const { blob, fileName } = await downloadDeliverableBlob(del.id);
      const delFile = await stageDir.getFileHandle(fileName, { create: true });
      const delWritable = await (delFile as any).createWritable();
      await delWritable.write(blob);
      await delWritable.close();
    } catch (e) {
      console.warn(`Failed to export deliverable ${del.id}:`, e);
    }
  }
}

async function exportViaZip(stages: StageExportData[], projectName: string): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const projFolder = zip.folder(projectName.replace(/[/\\]/g, "_"))!;
  const engFolder = projFolder.folder("Engineering")!;

  for (const data of stages) {
    const stageFolderName = `${padStageNumber(data.stage.templateSortOrder || 1)}_${data.stage.templateName.replace(/\s+/g, "_")}`;
    const stageFolder = engFolder.folder(stageFolderName)!;

    stageFolder.file("stage_summary.html", buildStageSummaryHtml(data, projectName));
    stageFolder.file("stage_summary.json", buildStageSummaryJson(data, projectName));

    for (const del of data.uploadedDeliverables) {
      try {
        const { blob, fileName } = await downloadDeliverableBlob(del.id);
        stageFolder.file(fileName, blob);
      } catch (e) {
        console.warn(`Failed to export deliverable ${del.id}:`, e);
      }
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/\s+/g, "_")}_Engineering_Pack.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportStagePack(stageId: number, projectId: number, projectName: string, stageName: string) {
  try {
    const data = await fetchStageData(stageId, projectId);

    if ("showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
        await exportViaFSA(data, projectName, dirHandle);
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return;
      }
    }

    await exportViaZip([data], projectName);
  } catch (err) {
    console.error("Export failed:", err);
    throw err;
  }
}

export async function exportAllStagesPack(projectId: number, projectName: string, stagesList: any[]) {
  try {
    const allData: StageExportData[] = [];
    for (const stage of stagesList) {
      const data = await fetchStageData(stage.id, projectId);
      allData.push(data);
    }

    if ("showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
        for (const data of allData) {
          await exportViaFSA(data, projectName, dirHandle);
        }
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return;
      }
    }

    await exportViaZip(allData, projectName);
  } catch (err) {
    console.error("Export all failed:", err);
    throw err;
  }
}
