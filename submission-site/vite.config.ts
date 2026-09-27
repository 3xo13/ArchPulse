import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function downloadFilename() {
  for (const filename of ["ArchPulse.rar", "archpulse.zip"]) {
    try {
      const file = statSync(fileURLToPath(new URL(`./public/downloads/${filename}`, import.meta.url)));
      if (file.isFile() && file.size > 0) return filename;
    } catch { /* Try the alternate archive format. */ }
  }
  return "";
}
export const downloadAvailable = () => Boolean(downloadFilename());

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __DOWNLOAD_FILENAME__: JSON.stringify(downloadFilename()) },
  build: { outDir: "dist", emptyOutDir: true },
});
