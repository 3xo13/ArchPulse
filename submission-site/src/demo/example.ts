import before from "../fixtures/snapshot-before.json";
import after from "../fixtures/snapshot-after.json";
import packet from "../fixtures/case-001.json";
import result from "../fixtures/result.json";
import { validateReport } from "./report";
// Validate the copied evidence with the same rules used for imported reports.
export const example = validateReport({ before, after, packet, result });
