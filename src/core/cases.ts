import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod/v4";
import { groupViolations } from "./grouping.js";
import { buildCasePacket } from "./casePacket.js";
import { architectureSchema, caseSnapshotSchema, casePacketSchema } from "./validation.js";
import { digest, internalPath, isScanArchive, json, publishFiles, readJson, withRepositoryLock } from "./storage.js";
import { loadBaseline, policyHash, stable } from "./provenance.js";
import { validateWithinWorkspace } from "./workspace.js";

const registrySchema = z.object({ next: z.number().int().positive(), groups: z.record(z.string(), z.string().regex(/^case-\d{3,}$/)) });
const indexSchema = z.object({ cases: z.array(z.object({ caseId: z.string().regex(/^case-\d{3,}$/) }).passthrough()) });
const metadataSchema = z.object({ snapshotHash: z.string(), packets: z.record(z.string(), z.string()), relationships: z.record(z.string(), z.array(z.string())) });
export interface CaseOptions { repoRoot?: string; snapshotPath: string; outDir?: string; configPath?: string; signal?: AbortSignal; }
export interface CaseIndexEntry { caseId: string; title: string; rule: string; severity: "error" | "warn"; violationCount: number; primaryFileCount: number; }
export interface CasesResult { caseCount: number; outDir: string; oversizedCases: string[]; cases: CaseIndexEntry[]; }

function discoverModules(root: string) {
  const modules: Array<{ path: string; package: string }> = [];
  const walk = (dir: string, pkg: string) => {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const data = z.object({ name: z.string().optional() }).passthrough().parse(readJson(manifest));
      pkg = data.name ?? pkg;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", ".archpulse", "dist", "coverage"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, pkg);
      else if (entry.isFile()) modules.push({ path: path.relative(root,file).replace(/\\/g,"/"), package: pkg });
    }
  };
  walk(root, "<root>"); return modules;
}
export async function generateCases(options: CaseOptions): Promise<CasesResult> {
  const root = fs.realpathSync(path.resolve(options.repoRoot ?? process.cwd()));
  return withRepositoryLock(root, () => {
    const source = path.resolve(root, options.snapshotPath);
    const snapshot = caseSnapshotSchema.parse(readJson(source));
    if (new Set(snapshot.violations.map(v=>v.id)).size !== snapshot.violations.length) throw new Error("Snapshot has duplicate violation IDs.");
    const config = architectureSchema.parse(readJson(path.resolve(root, options.configPath ?? "config/architecture.json")));
    const out = path.resolve(root, options.outDir ?? path.join(path.dirname(source), "cases"));
    if (isScanArchive(root,out)) {
      const baseline=loadBaseline(root,source);
      if (path.resolve(out)!==path.join(baseline.directory,"cases")) throw new Error("Cannot publish cases over another immutable scan.");
      const index=path.join(out,"index.json");
      validateWithinWorkspace(index,root);
      if (fs.existsSync(index)) {
        const metadataFile=path.join(out,"metadata.json");validateWithinWorkspace(metadataFile,root);
        const metadata=metadataSchema.parse(readJson(metadataFile));
        if(metadata.snapshotHash!==baseline.manifest.snapshotHash) throw new Error("Case baseline mismatch.");
        const entries=indexSchema.parse(readJson(index)).cases as unknown as CaseIndexEntry[];
        for(const entry of entries) {
          const file=path.join(out,`${entry.caseId}.json`);validateWithinWorkspace(file,root);
          if(digest(fs.readFileSync(file))!==metadata.packets[entry.caseId]) throw new Error("Case packet has been modified.");
        }
        return {caseCount:entries.length,outDir:out,oversizedCases:[],cases:entries};
      }
      if(policyHash(root)!==baseline.manifest.policyHash) throw new Error("Verification policy changed; capture a fresh baseline.");
    }
    fs.mkdirSync(out, { recursive: true });
    // Even explicit CLI output must not follow links through its managed files.
    const registryPath = internalPath(root, "case-registry.json");
    const registry = fs.existsSync(registryPath) ? registrySchema.parse(readJson(registryPath)) : { next: 1, groups: {} as Record<string,string> };
    const modules = discoverModules(root);
    const groups = groupViolations(snapshot);
    const ids = new Map<string,string>();
    for (const group of groups) {
      const signature = digest(stable({ violations: group.violations.map(v=>v.id).sort(), primaryFiles: group.primaryFiles }));
      let id = registry.groups[signature];
      if (!id) { id = `case-${String(registry.next++).padStart(3,"0")}`; registry.groups[signature] = id; }
      ids.set(group.groupKey, id);
    }
    const changes = new Map<string, string | null>();
    const entries: CaseIndexEntry[] = [], oversizedCases: string[] = [];
    const packets: Record<string,string> = {}, relationships: Record<string,string[]> = {};
    const previousIndex = path.join(out,"index.json");
    if (fs.existsSync(previousIndex)) {
      for (const { caseId } of indexSchema.parse(readJson(previousIndex)).cases) {
        for (const extension of ["json","md"]) changes.set(path.join(out,`${caseId}.${extension}`),null);
      }
    }
    for (const group of groups) {
      const id = ids.get(group.groupKey)!;
      const packet = buildCasePacket(id, group, { ...snapshot, modules }, config);
      const content = json(packet.json);
      packets[id] = digest(content);
      relationships[id] = (group.relatedGroups ?? []).map(key => ids.get(key)!);
      const related = relationships[id]!.length ? `\n## Related cases\n\n${relationships[id]!.join(", ")}\n` : "";
      changes.set(path.join(out,`${id}.json`), content);
      changes.set(path.join(out,`${id}.md`), packet.markdown + related);
      entries.push({ caseId: id, title: packet.json.title, rule: packet.json.rule, severity: packet.json.severity,
        violationCount: group.violations.length, primaryFileCount: group.primaryFiles.length });
      if (packet.exceedsBudget) oversizedCases.push(id);
    }
    changes.set(path.join(out,"index.json"),json({ cases: entries }));
    changes.set(path.join(out,"metadata.json"),json({ snapshotHash: digest(fs.readFileSync(source)), packets, relationships }));
    changes.set(registryPath,json(registry));
    for (const target of changes.keys()) validateWithinWorkspace(target, target === registryPath ? root : out);
    options.signal?.throwIfAborted();
    publishFiles(changes);
    return { caseCount: entries.length, outDir: out, oversizedCases, cases: entries };
  }, options.signal);
}

export async function ensureBaselineCases(root: string, identifier?: string, signal?: AbortSignal) {
  const baseline = loadBaseline(root, identifier);
  const directory = path.join(baseline.directory, "cases");
  validateWithinWorkspace(directory,root);
  if (!fs.existsSync(path.join(directory,"index.json"))) {
    if (policyHash(root) !== baseline.manifest.policyHash) throw new Error("Verification policy changed; capture a fresh baseline before generating cases.");
    await generateCases({ repoRoot: root, snapshotPath: baseline.snapshotPath, outDir: directory, signal });
  }
  const metadataFile = path.join(directory,"metadata.json");
  validateWithinWorkspace(metadataFile,root);
  const metadata = metadataSchema.parse(readJson(metadataFile));
  if (metadata.snapshotHash !== baseline.manifest.snapshotHash) throw new Error("Cases do not belong to this baseline.");
  const index = path.join(directory,"index.json"); validateWithinWorkspace(index,root);
  const cases = indexSchema.parse(readJson(index)).cases;
  return { ...baseline, caseDirectory: directory, cases, metadata };
}

export async function getCase(root: string, caseId: string, identifier?: string, signal?: AbortSignal) {
  if (!/^case-\d{3,}$/.test(caseId)) throw new Error("Invalid case ID.");
  const baseline = await ensureBaselineCases(root,identifier,signal);
  if (!baseline.cases.some(entry=>entry.caseId===caseId)) throw new Error(`Case '${caseId}' does not exist in this baseline.`);
  const file = path.join(baseline.caseDirectory,`${caseId}.json`); validateWithinWorkspace(file,root);
  if (digest(fs.readFileSync(file)) !== baseline.metadata.packets[caseId]) throw new Error("Case packet has been modified; capture a fresh baseline.");
  const packet = casePacketSchema.parse(readJson(file));
  // Validate its selected IDs against immutable scanner evidence even if metadata was edited.
  const snapshot = caseSnapshotSchema.parse(readJson(baseline.snapshotPath));
  if (packet.caseId!==caseId || packet.scanId!==snapshot.gitMarker || packet.violations.some(v=>!snapshot.violations.some(original=>stable(original)===stable(v)))) throw new Error("Invalid baseline case violations.");
  return { ...baseline, packet, packetPath: file };
}

/** Legacy fixtures can be compared, but cannot authorize a full verification. */
export async function getComparisonCase(root: string, before: string, caseId: string) {
  if (!/^case-\d{3,}$/.test(caseId)) throw new Error("Invalid case ID.");
  const source=path.resolve(root,before);
  if (fs.existsSync(path.join(path.dirname(source),"manifest.json"))) return (await getCase(root,caseId,source)).packet;
  const file=[path.join(path.dirname(source),"cases",`${caseId}.json`),path.join(path.dirname(source),`${caseId}.json`)].find(candidate=>fs.existsSync(candidate));
  if (!file) throw new Error("Case packet not found beside the baseline. Generate cases first.");
  const packet=z.object({caseId:z.literal(caseId),scanId:z.string(),violations:z.array(z.object({id:z.string()})).min(1)}).parse(readJson(file));
  const snapshot=caseSnapshotSchema.parse(readJson(source));
  if(packet.scanId!==snapshot.gitMarker)throw new Error("Case belongs to a different snapshot.");
  const violations=packet.violations.map(selected=>{
    const violation=snapshot.violations.find(v=>v.id===selected.id);
    if(!violation)throw new Error("Case violation IDs are missing from the baseline.");return violation;
  });
  return {caseId,violations};
}
