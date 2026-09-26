import React, { useState } from "react";
import { artifactLabels, readArtifact, validateReport, type ArtifactRole, type Report } from "../report";

export default function ImportReport({ onImport }: { onImport: (report: Report) => void }) {
  const [files, setFiles] = useState<Partial<Record<ArtifactRole, File>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      for (const role of ["before", "packet", "result"] as const) if (!files[role]) throw new Error(`${artifactLabels[role]}: select a file.`);
      const input: Partial<Record<ArtifactRole, unknown>> = {};
      for (const role of Object.keys(artifactLabels) as ArtifactRole[]) {
        const file = files[role]; if (file) input[role] = await readArtifact(file, role);
      }
      onImport(validateReport(input));
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <details style={{ margin: "12px 24px" }}>
    <summary>Import verification results</summary>
    <p>Select JSON artifacts from one run. Files stay in this browser and are not uploaded. Loading a report does not rerun checks.</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy} style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 12 }}>
        <legend>Verification artifacts (maximum 20 MiB each)</legend>
        {(Object.keys(artifactLabels) as ArtifactRole[]).map(role => <label key={role} style={{ display: "grid", gap: 4 }}>
          {artifactLabels[role]}
          <input type="file" accept=".json,application/json" onChange={event => setFiles(current => ({ ...current, [role]: event.target.files?.[0] }))} />
        </label>)}
        <button type="submit">{busy ? "Loading…" : "Load report"}</button>
      </fieldset>
    </form>
    <p>The after snapshot is required when the report records a completed comparison. Execution details are optional and enable per-command counts.</p>
    {error && <p role="alert" style={{ color: "#b91c1c", overflowWrap: "anywhere" }}>{error}</p>}
  </details>;
}
