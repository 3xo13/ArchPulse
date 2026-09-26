import { it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { publishFiles, withRepositoryLock } from "./storage.js";
vi.mock("node:fs",async original=>{
  const actual=await original<typeof import("node:fs")>();return {...actual,renameSync:vi.fn(actual.renameSync),unlinkSync:vi.fn(actual.unlinkSync)};
});
const real=await vi.importActual<typeof import("node:fs")>("node:fs");
const temporary:string[]=[];
const directory=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse-transaction-"));temporary.push(root);return root;};
afterEach(()=>{vi.restoreAllMocks();vi.mocked(fs.renameSync).mockImplementation(real.renameSync);vi.mocked(fs.unlinkSync).mockImplementation(real.unlinkSync);for(const root of temporary.splice(0))fs.rmSync(root,{recursive:true,force:true});});
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

it("rolls back installed files and deletions when final validation fails",()=>{
  const root=directory(),a=path.join(root,"a"),b=path.join(root,"b"),c=path.join(root,"c");
  fs.writeFileSync(a,"old a");fs.writeFileSync(b,"old b");
  const failure=new Error("deadline exceeded");
  expect(()=>publishFiles(new Map([[a,"new a"],[b,null],[c,"new c"]]),undefined,()=>{
    expect(fs.readFileSync(a,"utf8")).toBe("new a");expect(fs.existsSync(b)).toBe(false);expect(fs.existsSync(c)).toBe(true);
    throw failure;
  })).toThrow(failure);
  expect(fs.readFileSync(a,"utf8")).toBe("old a");expect(fs.readFileSync(b,"utf8")).toBe("old b");
  expect(fs.readdirSync(root).sort()).toEqual(["a","b"]);
});

it("retains an undeletable backup, cleans the others, and reports success on stderr",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  const root=directory(),a=path.join(root,"a"),b=path.join(root,"b");fs.writeFileSync(a,"old a");fs.writeFileSync(b,"old b");
  vi.mocked(fs.unlinkSync).mockImplementation(file=>{
    if(String(file).startsWith(a+".")&&String(file).endsWith(".bak"))throw Object.assign(new Error("locked"),{code:"EPERM"});
    real.unlinkSync(file);
  });
  expect(()=>publishFiles(new Map([[a,"new a"],[b,"new b"]]))).not.toThrow();
  expect(fs.readFileSync(a,"utf8")).toBe("new a");expect(fs.readFileSync(b,"utf8")).toBe("new b");
  const leftovers=fs.readdirSync(root).filter(name=>name.endsWith(".bak"));expect(leftovers).toHaveLength(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining(`1 file(s) retained:\n${path.join(root,leftovers[0]!)}`));
});

it("ignores already-absent cleanup files",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  const root=directory(),file=path.join(root,"file");fs.writeFileSync(file,"old");
  publishFiles(new Map([[file,"new"]]),undefined,()=>{
    for(const name of fs.readdirSync(root).filter(name=>name.endsWith(".bak")))real.unlinkSync(path.join(root,name));
  });
  expect(log).not.toHaveBeenCalled();expect(fs.readFileSync(file,"utf8")).toBe("new");
});

it("preserves the original error if temporary-file cleanup also fails",()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  const root=directory(),file=path.join(root,"file");fs.writeFileSync(file,"old");
  vi.mocked(fs.unlinkSync).mockImplementation(target=>{
    if(String(target).endsWith(".tmp"))throw Object.assign(new Error("locked temp"),{code:"EPERM"});real.unlinkSync(target);
  });
  const original=new Error("original validation error");
  let caught:unknown;try{publishFiles(new Map([[file,"new"]]),()=>{throw original;});}catch(error){caught=error;}
  expect(caught).toBe(original);expect(fs.readFileSync(file,"utf8")).toBe("old");
  expect(log).toHaveBeenCalledWith(expect.stringContaining(".tmp"));
});

it("preserves recovery backups when rollback fails",()=>{
  const root=directory(),file=path.join(root,"file");fs.writeFileSync(file,"old");
  vi.mocked(fs.renameSync).mockImplementation((from,to)=>{
    if(String(from).endsWith(".bak"))throw new Error("rollback denied");real.renameSync(from,to);
  });
  expect(()=>publishFiles(new Map([[file,"new"]]),undefined,()=>{throw new Error("expired");})).toThrow(AggregateError);
  const backups=fs.readdirSync(root).filter(name=>name.endsWith(".bak"));expect(backups).toHaveLength(1);
  expect(fs.readFileSync(path.join(root,backups[0]!),"utf8")).toBe("old");
});
