import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const tsxEsm = fileURLToPath(pathToFileURL(req.resolve("tsx/esm")).href);
const serverTs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/mcp/server.ts");

console.log("loader:", tsxEsm);
console.log("server:", serverTs);

const r = spawnSync(process.execPath, ["--import", pathToFileURL(tsxEsm).href, serverTs], {
  input: "",
  encoding: "utf8",
  timeout: 8000,
  env: { ...process.env, ARCHPULSE_ROOT: process.cwd() },
});
console.log("error:", r.error?.message ?? "none");
console.log("status:", r.status);
console.log("stderr snippet:", r.stderr?.slice(0, 300));
