import { preview } from "vite";
export default async function serve() {
  const server = await preview({ preview: { host: "127.0.0.1", port: 4198, strictPort: true } });
  return () => new Promise<void>((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
  });
}
