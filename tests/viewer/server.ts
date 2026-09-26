import { preview } from "vite";
import * as path from "node:path";

/** Keep the preview server in-process so Windows cleanup needs no shell/taskkill. */
export default async function serveProductionViewer() {
  const server = await preview({
    configFile: path.resolve("src/viewer/vite.config.ts"),
    preview: { host: "127.0.0.1", port: 4197, strictPort: true },
  });
  return () => new Promise<void>((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
}
