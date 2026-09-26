/** Committed example data; never presented as a live verification. */

import type { CasePacket, Snapshot, VerifyResult } from "./types";

import snapshotBefore from "../../artifacts/example/snapshot-before.json";
import snapshotAfter from "../../artifacts/example/snapshot-after.json";
import case001 from "../../artifacts/example/case-001.json";
import result001 from "../../artifacts/example/result.json";

/** All case packets available for display. Add entries here when new fixtures land. */
export const cases: CasePacket[] = [case001 as CasePacket];

/** Map caseId → before snapshot */
export const beforeSnapshots: Record<string, Snapshot> = {
  "case-001": snapshotBefore as Snapshot,
};

/** Map caseId → after snapshot */
export const afterSnapshots: Record<string, Snapshot> = {
  "case-001": snapshotAfter as Snapshot,
};

/** Map caseId → verify result */
export const results: Record<string, VerifyResult> = {
  "case-001": result001 as VerifyResult,
};
