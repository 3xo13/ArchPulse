import { it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { publishFiles, withRepositoryLock } from "./storage.js";
vi.mock("node:fs",async original=>{
  const actual=await original<typeof import("node:fs")>();return {...actual,renameSync:vi.fn(actual.renameSync)};
});
const real=await vi.importActual<typeof import("node:fs")>("node:fs");
const temporary:string[]=[];
const directory=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse-transaction-"));temporary.push(root);return root;};
afterEach(()=>{vi.mocked(fs.renameSync).mockImplementation(real.renameSync);for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it("rolls back writes and deletions across multiple directories",()=>{
  const root=directory();const a=path.join(root,"old.json"),b=path.join(root,"stale.json"),c=path.join(root,"new/result.json");
  fs.writeFileSync(a,"old");fs.writeFileSync(b,"stale");
  vi.mocked(fs.renameSync).mockImplementation((from,to)=>{if(String(to)===c)throw new Error("publication failure");real.renameSync(from,to);});
  expect(()=>publishFiles(new Map([[a,"replacement"],[b,null],[c,"new"]]))).toThrow(/publication failure/);
  expect(fs.readFileSync(a,"utf8")).toBe("old");expect(fs.readFileSync(b,"utf8")).toBe("stale");
  expect(fs.existsSync(c)).toBe(false);expect(fs.readdirSync(root).some(name=>/\.(tmp|bak)$/.test(name))).toBe(false);
});
it("releases the repository lock after errors and supports cancelling a waiting writer",async()=>{
  const root=directory();let release!:()=>void;
  const first=withRepositoryLock(root,()=>new Promise<void>(resolve=>{release=resolve;}));
  const controller=new AbortController();const second=withRepositoryLock(root,()=>{},controller.signal);
  controller.abort();await expect(second).rejects.toThrow();release();await first;
  await expect(withRepositoryLock(root,()=>{throw new Error("operation failure");})).rejects.toThrow(/operation failure/);
  await expect(withRepositoryLock(root,()=>42)).resolves.toBe(42);
});
it("checks cancellation after staging and preserves the previous artifacts", () => {
  const root = directory(); const file = path.join(root, "result.json");
  fs.writeFileSync(file, "previous");
  const controller = new AbortController();
  expect(() => publishFiles(new Map([[file, "new"]]), () => {
    controller.abort(); controller.signal.throwIfAborted();
  })).toThrow();
  expect(fs.readFileSync(file, "utf8")).toBe("previous");
  expect(fs.readdirSync(root)).toEqual(["result.json"]);
});
