import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import before from "../../artifacts/example/snapshot-before.json";
import after from "../../artifacts/example/snapshot-after.json";
import packet from "../../artifacts/example/case-001.json";
import result from "../../artifacts/example/result.json";
import GraphView from "./components/GraphView";
import { validateReport } from "./report";

afterEach(cleanup);
it("renders arbitrary imported layer names without using inherited object properties", () => {
  const report = validateReport({ before, after, packet, result });
  report.before.modules.forEach(module => { module.layer = "__proto__"; });
  render(<GraphView before={report.before} primaryFiles={packet.primaryFiles} />);
  expect(screen.getByRole("heading", { name: "Focused Graph" })).toBeTruthy();
});
function file(data: unknown) {
  const text = JSON.stringify(data);
  const selected = new File([text], "artifact.json", { type: "application/json" });
  // jsdom File does not implement the browser's Blob.text yet.
  Object.defineProperty(selected, "text", { value: async () => text });
  return selected;
}
it("imports a real-shaped run, preserves it on invalid import and returns to examples", async () => {
  const user = userEvent.setup(); render(<App />);
  expect(screen.getByText("Example data")).toBeTruthy();
  expect(screen.getByText("Passed · 14 passed")).toBeTruthy();
  await user.click(screen.getByText("Import verification results"));
  for (const [label, data] of [["Before snapshot", before], ["After snapshot", after], ["Case packet", { ...packet, title: "Imported case" }], ["Verification result", result]] as const) {
    await user.upload(screen.getByLabelText(label), file(data));
  }
  await user.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByText("Imported report")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Imported case" })).toBeTruthy();
  await user.upload(screen.getByLabelText("Verification result"), file({ ...result, caseId: "case-999" }));
  await user.click(screen.getByRole("button", { name: "Load report" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("caseId"));
  expect(screen.getByRole("heading", { name: "Imported case" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show example" }));
  expect(screen.getByText("Example data")).toBeTruthy();
});
it("disables the after graph for an interrupted run", async () => {
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByText("Import verification results"));
  const interrupted = { ...result, status: "failed", afterId: "", resolvedViolations: [], persistentViolations: [], newViolations: [] };
  for (const [label, data] of [["Before snapshot", before], ["Case packet", packet], ["Verification result", interrupted]] as const) await user.upload(screen.getByLabelText(label), file(data));
  await user.click(screen.getByRole("button", { name: "Load report" }));
  await screen.findByText("Imported report");
  expect(screen.getByRole("button", { name: /^After/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("note").textContent).toContain("no completed comparison");
});
it("switches graphs and enables source links only with explicit provenance", async () => {
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByRole("button", { name: /^After/ }));
  const graph = screen.getByRole("heading", { name: "Focused Graph" }).closest("section")!;
  expect(within(graph).getByText("post-repair")).toBeTruthy();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  await user.click(screen.getByText("Source link settings"));
  await user.type(screen.getByLabelText("GitHub repository URL"), "https://github.com/team/project");
  await user.type(screen.getByLabelText("After revision"), "repair/demo");
  expect(screen.getAllByRole("link", { name: "After" })[0]?.getAttribute("href")).toContain("/blob/repair%2Fdemo/");
  expect(screen.queryAllByRole("link", { name: "Before" })).toHaveLength(0);
});
