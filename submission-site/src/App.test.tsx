import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import Demo from "./demo/Demo";
import Download from "./components/Download";
import GraphExplorer from "./components/GraphExplorer";
import { example } from "./demo/example";

beforeEach(() => { window.history.replaceState({}, "", "/"); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const file = (data: unknown) => {
  const text = JSON.stringify(data);
  const value = new File([text], "artifact.json", { type: "application/json" });
  Object.defineProperty(value, "text", { value: async () => text });
  return value;
};
async function uploadReport(result = example.result, after = example.after) {
  const user = userEvent.setup();
  const importer = screen.getByText("Open your own ArchPulse report (optional)");
  if (!importer.closest("details")?.open) await user.click(importer);
  const values = [["Before snapshot", example.before], ["Case packet", example.packet], ["Verification result", result], ...(after ? [["After snapshot", after]] : [])] as const;
  for (const [label, data] of values) await user.upload(screen.getByLabelText(label as string), file(data));
  await user.click(screen.getByRole("button", { name: "Load report" }));
}

describe("submission experience", () => {
  it("shows the landing page and complete Bob instructions", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Repair with evidence.");
    expect(screen.getByRole("link", { name: /Explore interactive demo/ }).getAttribute("href")).toBe("#/demo");
    expect(screen.getByRole("heading", { name: "Install in Bob IDE" })).toBeTruthy();
    expect(screen.getByText(/npm ci --include=dev --ignore-scripts/)).toBeTruthy();
    expect(screen.getByText("scan_repository", { selector: "code" })).toBeTruthy();
  });
  it("responds to direct demo hashes and browser navigation events", () => {
    window.location.hash = "#/demo"; render(<App />);
    expect(screen.getByRole("heading", { name: /Follow the evidence/ })).toBeTruthy();
    window.history.replaceState({}, "", "/"); fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Understand the");
  });
  it("supports all guided steps and distinguishes unrelated violations", async () => {
    const user = userEvent.setup(); render(<Demo />);
    await user.click(screen.getByRole("button", { name: /Next: Repair case/ }));
    expect(screen.getByRole("heading", { name: example.packet.title })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Next: Repair outcome/ }));
    await user.click(screen.getByRole("button", { name: "After" }));
    expect(screen.getByText("1 repository-wide violations · after snapshot")).toBeTruthy();
    await user.click(screen.getByText(/Inspect dependency changes/));
    expect(screen.getAllByText(/Removed/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Next: Verification evidence/ }));
    expect(screen.getByText(/1 unrelated baseline violation remains/)).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Passed" })).toHaveLength(2);
    await user.click(screen.getByText("Recorded test commands and full output"));
    expect(screen.getByText((_text, element) => element?.tagName === "PRE" && element.textContent === example.result.testCommand)).toBeTruthy();
  });
  it("selects graph nodes and edges, filters violations and resets", async () => {
    const user = userEvent.setup();
    const { container } = render(<GraphExplorer snapshot={example.before} primaryFiles={example.before.modules.map(m => m.path)} />);
    const target = "demo/packages/ui/src/orderService.ts";
    await user.click(screen.getByRole("button", { name: `Inspect ${target}` }));
    const inspector = screen.getByRole("region", { name: "File inspector" });
    await user.click(within(inspector).getByRole("button", { name: /OUT demo\/packages\/db\/src\/index.ts/ }));
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    await user.click(screen.getByLabelText("Violations only"));
    expect(screen.queryByRole("button", { name: "Inspect demo/packages/shared/src/types.ts" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset selection" }));
    expect(screen.queryByRole("region", { name: "File inspector" })).toBeNull();
    const node = screen.getByRole("button", { name: `Inspect ${target}` });
    node.focus(); await user.keyboard("{Enter}");
    expect(node.getAttribute("aria-pressed")).toBe("true");
  });
  it("shows the whole repository without labelling every file as part of the case", () => {
    render(<GraphExplorer snapshot={example.before} primaryFiles={example.packet.primaryFiles} repositoryView />);
    expect(screen.getByRole("button", { name: "Inspect demo/packages/ui/src/orderService.ts" }).textContent).toContain("primary");
    expect(screen.getByRole("button", { name: "Inspect demo/packages/shared/src/types.ts" }).textContent).not.toContain("primary");
  });
  it("preserves valid imported evidence after a rejected import and resets", async () => {
    const user = userEvent.setup(); render(<Demo />);
    await uploadReport(); expect(screen.getByText("Imported report", { exact: true })).toBeTruthy();
    await user.upload(screen.getByLabelText("Verification result"), file({ ...example.result, caseId: "case-999" }));
    await user.click(screen.getByRole("button", { name: "Load report" }));
    expect(screen.getByRole("alert").textContent).toContain("caseId");
    expect(screen.getByText("Imported report", { exact: true })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show example" }));
    expect(screen.getByText("Recorded example", { exact: true })).toBeTruthy();
  });
  it("keeps incomplete reports usable without an after graph", async () => {
    render(<Demo />);
    const result = { ...example.result, status: "failed" as const, afterId: "", resolvedViolations: [], persistentViolations: [], newViolations: [] };
    const user = userEvent.setup(); await user.click(screen.getByText("Open your own ArchPulse report (optional)"));
    for (const [label, value] of [["Before snapshot", example.before], ["Case packet", example.packet], ["Verification result", result]] as const) await user.upload(screen.getByLabelText(label), file(value));
    await user.click(screen.getByRole("button", { name: "Load report" }));
    expect(screen.getByRole("button", { name: "After" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("note").textContent).toContain("no completed comparison");
  });
  it("enables source URLs only with supplied provenance", async () => {
    const user = userEvent.setup(); render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Inspect demo/packages/ui/src/orderService.ts" }));
    expect(screen.queryByRole("link", { name: /View source/ })).toBeNull();
    await user.click(screen.getByText("Source link settings"));
    await user.type(screen.getByLabelText("GitHub repository URL"), "https://github.com/team/project");
    await user.type(screen.getByLabelText("Before revision"), "repair/demo");
    expect(screen.getByRole("link", { name: /View source/ }).getAttribute("href")).toContain("/blob/repair%2Fdemo/");
  });
  it("only links to a download when it was included in the build", () => {
    const { rerender } = render(<Download filename="" />);
    expect(screen.getByRole("button", { name: "Download coming soon" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<Download filename="archpulse.zip" />);
    expect(screen.getByRole("link", { name: /Download for Bob/ }).getAttribute("download")).toBe("archpulse.zip");
    rerender(<Download filename="ArchPulse.rar" />);
    expect(screen.getByRole("link", { name: /Download for Bob/ }).getAttribute("href")).toBe("/downloads/ArchPulse.rar");
  });
});
