import { it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { publishArtifacts } from "./artifacts.js";

vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-publish-"));
  vi.mocked(fs.renameSync).mockImplementation(actual.renameSync);
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

it("publishes a complete pair and cleans staging", () => {
  publishArtifacts(temp, "snapshot", "graph");
  expect(fs.readFileSync(path.join(temp, "snapshot.json"), "utf8")).toBe("snapshot");
  expect(fs.readdirSync(temp).sort()).toEqual(["graph.html", "snapshot.json"]);
});
it.each([true, false])("rolls back a failed second publication (existing pair: %s)", existing => {
  if (existing) publishArtifacts(temp, "old snapshot", "old graph");
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    if (String(from).includes(".archpulse-stage-") && path.basename(String(from)) === "graph.html") {
      throw new Error("simulated publication failure");
    }
    actual.renameSync(from, to);
  });
  expect(() => publishArtifacts(temp, "new snapshot", "new graph")).toThrow(/publication failure/);
  if (existing) {
    expect(fs.readFileSync(path.join(temp, "snapshot.json"), "utf8")).toBe("old snapshot");
    expect(fs.readFileSync(path.join(temp, "graph.html"), "utf8")).toBe("old graph");
  }
  expect(fs.readdirSync(temp).sort()).toEqual(existing ? ["graph.html", "snapshot.json"] : []);
});
it("rejects a directory artifact target without altering the existing snapshot", () => {
  fs.writeFileSync(path.join(temp, "snapshot.json"), "old");
  fs.mkdirSync(path.join(temp, "graph.html"));
  expect(() => publishArtifacts(temp, "new", "new")).toThrow(/regular file/);
  expect(fs.readFileSync(path.join(temp, "snapshot.json"), "utf8")).toBe("old");
});
