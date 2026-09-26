import React from "react";
import type { CasePacket, VerifyResult } from "../types";
import type { Execution } from "../report";
import { sourceUrl } from "../sourceUrl";
import { checkOutcome } from "../checkSummary";

interface Props {
  casePacket: CasePacket;
  result: VerifyResult | undefined;
  repository: string;
  beforeRevision: string;
  afterRevision: string;
  execution?: Execution;
}
export default function SourceLinks({ casePacket, result, repository, beforeRevision, afterRevision, execution }: Props) {
  const files = [...new Set([...casePacket.primaryFiles, ...casePacket.relevantTests])];
  const missing = files.some(file => !sourceUrl(repository, beforeRevision, file) || !sourceUrl(repository, afterRevision, file));
  return <section style={{ background: "#fff", border: "1px solid #e1e4e8", borderRadius: 8, padding: 18 }}>
    <h2>Source Links</h2>
    {missing && <p>Some source links are unavailable. Copy the paths below, or supply a GitHub repository and the corresponding revision in Source link settings.</p>}
    <ul style={{ listStyle: "none", padding: 0 }}>
      {files.map(file => <li key={file} style={{ padding: "8px 0", borderBottom: "1px solid #e1e4e8" }}>
        <code style={{ userSelect: "text", overflowWrap: "anywhere" }}>{file}</code>{" "}
        {casePacket.relevantTests.includes(file) && <span>(test) </span>}
        {([ ["Before", beforeRevision], ["After", afterRevision] ] as const).map(([label, revision]) => {
          const href = sourceUrl(repository, revision, file);
          return href ? <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ marginRight: 12 }}>{label}</a>
            : <span key={label} style={{ marginRight: 12 }}>{label}: unavailable</span>;
        })}
      </li>)}
    </ul>
    <h3>Recorded test commands</h3>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result?.testCommand || "No test commands were recorded as executed."}</pre>
    {result && <>
      <p>Tests: <strong>{checkOutcome(result.testExitCode)}</strong>; Typecheck: <strong>{checkOutcome(result.typecheckExitCode)}</strong></p>
      <details><summary>Recorded output</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.testOutput}</pre></details>
    </>}
    {execution && <details><summary>Per-command execution details</summary>
      {([ ["Test", execution.tests], ["Typecheck", execution.typechecks] ] as const).flatMap(([kind, runs]) => runs.map((run, index) =>
        <div key={`${kind}-${index}`}><h4>{kind} {index + 1}: {checkOutcome(run.exitCode ?? -1)}</h4>
          <code>{run.command}</code><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{run.output}</pre></div>))}
    </details>}
  </section>;
}
