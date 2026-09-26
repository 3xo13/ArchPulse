import React, { useState } from "react";
import {
  cases,
  beforeSnapshots,
  afterSnapshots,
  results,
  GITHUB_BASE,
} from "./data";
import CaseList from "./components/CaseList";
import StatusBadge from "./components/StatusBadge";
import SummaryCards from "./components/SummaryCards";
import ViolationDiff from "./components/ViolationDiff";
import GraphView from "./components/GraphView";
import SourceLinks from "./components/SourceLinks";

const BRANCH = "feature/viewer";

export default function App() {
  const [selectedId, setSelectedId] = useState<string>(
    cases[0]?.caseId ?? ""
  );

  const casePacket = cases.find((c) => c.caseId === selectedId);
  const before     = beforeSnapshots[selectedId];
  const after      = afterSnapshots[selectedId];
  const result     = results[selectedId];

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
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar */}
        <CaseList
          cases={cases}
          results={results}
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
          {casePacket && before && after ? (
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
                      {after.gitMarker}
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
              {result && <SummaryCards result={result} />}

              {/* ── Sections ── */}
              <ViolationDiff
                casePacket={casePacket}
                before={before}
                after={after}
                result={result}
              />

              <GraphView
                before={before}
                after={after}
                primaryFiles={casePacket.primaryFiles}
              />

              <SourceLinks
                casePacket={casePacket}
                result={result}
                githubBase={GITHUB_BASE}
                branch={BRANCH}
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
