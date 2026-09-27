import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

/** Session-local previews expose registered HTML only, never filesystem paths. */
export function createGraphPreview() {
  const graphs = new Map<string, Buffer>();
  const limit = 32 * 1024 * 1024;
  let size = 0;
  let server: Server | undefined;
  let starting: Promise<string> | undefined;
  let closed = false;
  const start = () => starting ??= new Promise<string>((resolve, reject) => {
    const instance = createServer((request, response) => {
      const address = instance.address();
      const authority = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
      if (request.headers.host !== authority || (request.headers.origin && request.headers.origin !== `http://${authority}`)) {
        response.writeHead(403).end(); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end(); return;
      }
      const graph = graphs.get(request.url ?? "");
      if (!graph) { response.writeHead(404).end("Graph preview expired or unavailable. Rescan to get a new link."); return; }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Content-Length": graph.length,
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : graph);
    });
    server = instance;
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      if (!address || typeof address === "string") { reject(new Error("Graph preview did not start.")); return; }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return {
    async add(html: string): Promise<string> {
      if (closed) throw new Error("Graph preview is shutting down.");
      const bytes = Buffer.from(html);
      if (bytes.length > limit) throw new Error("Graph exceeds preview capacity; open the saved HTML file.");
      const origin = await start();
      if (closed) throw new Error("Graph preview is shutting down.");
      while (size + bytes.length > limit) {
        const oldest = graphs.keys().next().value!;
        size -= graphs.get(oldest)!.length; graphs.delete(oldest);
      }
      const route = `/graph/${randomUUID()}`;
      graphs.set(route, bytes); size += bytes.length;
      return origin + route;
    },
    async close(): Promise<void> {
      closed = true;
      await starting?.catch(() => undefined);
      graphs.clear(); size = 0;
      const instance = server;
      if (!instance?.listening) return;
      await new Promise<void>((resolve, reject) => {
        instance.close(error => error ? reject(error) : resolve());
        instance.closeAllConnections();
      });
    },
  };
}
