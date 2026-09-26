/** Drain tool operations after closing the transport, which aborts SDK request signals. */
export function createLifecycle(close: () => Promise<void>) {
  const active = new Set<Promise<unknown>>();
  let closing = false;
  let shutdown: Promise<void> | undefined;
  const stop = (error?: unknown): Promise<void> => {
    if (shutdown) return shutdown;
    closing = true;
    if (error) { console.error("[archpulse] Input transport failed:", error); process.exitCode = 1; }
    shutdown = (async () => {
      const deadline = setTimeout(() => {
        console.error("[archpulse] Shutdown did not finish within ten seconds.");
        process.exit(1);
      }, 10_000);
      try {
        try { await close(); }
        catch (failure) { console.error("[archpulse] Transport close failed:", failure); process.exitCode = 1; }
        await Promise.allSettled([...active]);
      } finally {
        clearTimeout(deadline);
        process.stdin.off("end", end); process.stdin.off("error", inputError);
        process.off("SIGINT", end); process.off("SIGTERM", end);
      }
    })();
    return shutdown;
  };
  const end = () => { void stop(); };
  const inputError = (error: Error) => { void stop(error); };
  return {
    async run<T>(action: () => Promise<T>): Promise<T> {
      if (closing) throw new Error("MCP server is shutting down.");
      const operation = Promise.resolve().then(action);
      active.add(operation);
      try { return await operation; }
      finally { active.delete(operation); }
    },
    listen() {
      process.stdin.once("end", end); process.stdin.once("error", inputError);
      process.once("SIGINT", end); process.once("SIGTERM", end);
      // EOF may already have arrived while asynchronous server setup completed.
      if (process.stdin.readableEnded) end();
    },
    stop,
  };
}
