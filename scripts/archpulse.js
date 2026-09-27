#!/usr/bin/env node
// Resolve the loader from this installation, independently of the target workspace.
try {
  const { register } = await import("tsx/esm/api");
  register({ tsconfig: false });
  await import("../src/cli/index.ts");
} catch (error) {
  console.error(`ArchPulse could not start: ${error.message}`);
  console.error("Run npm ci --include=dev --ignore-scripts in the ArchPulse installation folder.");
  process.exitCode = 2;
}
