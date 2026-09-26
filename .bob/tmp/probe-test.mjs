import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const probePath = path.join(__dirname, "probe.mjs");
const r = spawnSync(process.execPath, [probePath], {
  input: "",
  encoding: "utf8",
  timeout: 5000,
});
console.log("error:", r.error?.message ?? "none");
console.log("status:", r.status);
console.log("stderr:", JSON.stringify(r.stderr));
