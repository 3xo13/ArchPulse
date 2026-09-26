import React, { useState } from "react";
import {
  cases,
  beforeSnapshots,
  afterSnapshots,
  results,

} from "./data";
import CaseList from "./components/CaseList";
import StatusBadge from "./components/StatusBadge";
import SummaryCards from "./components/SummaryCards";
import ViolationDiff from "./components/ViolationDiff";
import GraphView from "./components/GraphView";
import SourceLinks from "./components/SourceLinks";

import ImportReport from "./components/ImportReport";
import type { Report } from "./report";
import { revisionFromMarker } from "./sourceUrl";

export default function App() {
  const [selectedId, setSelectedId] = useState<string>(
    cases[0]?.caseId ?? ""
  );

  const [imported, setImported] = useState<Report>();
  const [repository, setRepository] = useState("");
  const [beforeRevision, setBeforeRevision] = useState("");
  const [afterRevision, setAfterRevision] = useState("");
  const casePacket = imported?.packet ?? cases.find((c) => c.caseId === selectedId);
  const before = imported ? imported.before : beforeSnapshots[selectedId];
  const after = imported ? imported.after : afterSnapshots[selectedId];
  const result = imported ? imported.result : results[selectedId];
  const importReport = (report: Report) => {
    setImported(report); setSelectedId(report.packet.caseId);
    setRepository(""); setBeforeRevision(""); setAfterRevision("");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "100vh",
        background: "var(--bg, #f4f5f7)",
      }}
    >
      {/* ── Top bar ── */}
      <header
        style={{
          background: "#1a1d21",
          color: "#fff",
          padding: "0 24px",
          height: "var(--header-h, 56px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          borderBottom: "1px solid #2d3139",
        }}
      >
        {/* Left: brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: "-0.02em",
              color: "#fff",
            }}
          >
            ArchPulse
          </span>
          <span
            style={{
              marginLeft: 10,
              paddingLeft: 10,
              borderLeft: "1px solid #3d4148",
              fontSize: 12,
              color: "#8b949e",
              fontWeight: 400,
            }}
          >
            Architecture verification results
          </span>
        </div>

        {/* Right: status + reason */}
        {result && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusBadge result={result} size="lg" />
            <span
              style={{
                fontSize: 11,
                color: "#8b949e",
                maxWidth: 380,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {result.reason}
            </span>
          </div>
        )}
      </header>

      {/* ── Body ── */}
      <div style={{ padding: "12px 24px", background: "#eff6ff" }}>
        <strong>{imported ? "Imported report" : "Example data"}</strong>
        <p>{imported ? "Recorded evidence supplied by you; importing does not rerun verification." : "This saved demonstration does not show the current repository's verification status."}</p>
        <button onClick={() => { setImported(undefined); setSelectedId(cases[0]?.caseId ?? ""); setRepository(""); setBeforeRevision(""); setAfterRevision(""); }}>Show example</button>
      </div>
      <ImportReport onImport={importReport} />
      <details style={{ margin: "12px 24px" }}>
        <summary>Source link settings</summary>
        <p>Links need a GitHub repository and a commit or revision. Explicit revisions are supplied by you, not verified by this viewer.</p>
        <label>GitHub repository URL <input type="url" placeholder="https://github.com/owner/repository" value={repository} onChange={event => setRepository(event.target.value)} /></label>{" "}
        <label>Before revision <input value={beforeRevision} placeholder={revisionFromMarker(before?.gitMarker) || "Enter a revision"} onChange={event => setBeforeRevision(event.target.value)} /></label>{" "}
        <label>After revision <input value={afterRevision} placeholder={revisionFromMarker(after?.gitMarker) || "Enter a revision"} onChange={event => setAfterRevision(event.target.value)} /></label>
      </details>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar */}
        <CaseList
          cases={imported ? [imported.packet] : cases}
          results={imported ? { [imported.packet.caseId]: imported.result } : results}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Main scroll area */}
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px 32px",
            minWidth: 0,
          }}
        >
          {casePacket && before ? (
            <>
              {/* ── Case header ── */}
              <div
                style={{
                  marginBottom: 16,
                  paddingBottom: 14,
                  borderBottom: "1px solid var(--border, #e1e4e8)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 4,
                  }}
                >
                  <h1
                    style={{
                      fontSize: 16,
                      fontWeight: 800,
                      color: "var(--text, #1a1d21)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {casePacket.title}
                  </h1>
                  <code
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--accent, #2563eb)",
                      background: "var(--accent-bg, #eff6ff)",
                      padding: "2px 8px",
                      borderRadius: 8,
                      border: "1px solid #bfdbfe",
                    }}
                  >
                    {casePacket.caseId}
                  </code>
                  {result && <StatusBadge result={result} size="md" />}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted, #586069)",
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    Baseline:{" "}
                    <code
                      style={{
                        fontWeight: 600,
                        color: "var(--text, #1a1d21)",
                      }}
                    >
                      {before.gitMarker}
                    </code>
                  </span>
                  <span style={{ color: "var(--faint, #8b949e)" }}>→</span>
                  <span>
                    After:{" "}
                    <code
                      style={{
                        fontWeight: 600,
                        color: "var(--text, #1a1d21)",
                      }}
                    >
                      {after?.gitMarker ?? "Unavailable"}
                    </code>
                  </span>
                  <span style={{ color: "var(--faint, #8b949e)" }}>·</span>
                  <span>
                    Scanner:{" "}
                    <code style={{ color: "var(--muted, #586069)" }}>
                      {before.scannerVersion}
                    </code>
                  </span>
                </div>
              </div>

              {/* ── Summary cards ── */}
              {result && <SummaryCards result={result} execution={imported?.execution} />}

              {/* ── Sections ── */}
              <ViolationDiff
                casePacket={casePacket}
                before={before}
                after={after}
                result={result}
              />

              <GraphView
                key={`${imported ? "imported" : "example"}-${before.timestamp}-${after?.timestamp ?? "none"}`}
                before={before}
                after={after}
                primaryFiles={casePacket.primaryFiles}
              />

              <SourceLinks
                execution={imported?.execution}
                casePacket={casePacket}
                result={result}
                repository={repository}
                beforeRevision={beforeRevision || revisionFromMarker(before.gitMarker)}
                afterRevision={afterRevision || revisionFromMarker(after?.gitMarker)}
              />
            </>
          ) : (
            <div
              style={{
                color: "var(--muted, #586069)",
                fontStyle: "italic",
                padding: "60px 0",
                textAlign: "center",
                fontSize: 13,
              }}
            >
              {selectedId
                ? `No fixture data found for ${selectedId}.`
                : "Select a case from the sidebar."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
