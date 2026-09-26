import { afterEach, expect, it, vi } from "vitest";
import { createLifecycle } from "./lifecycle.js";

const exitCode=process.exitCode;
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();process.exitCode=exitCode;});
it("closes once, rejects new work, and waits for active cleanup on input failure",async()=>{
  vi.spyOn(console,"error").mockImplementation(()=>{});
  let release!:()=>void;
  const close=vi.fn(async()=>{});
  const lifecycle=createLifecycle(close);
  const operation=lifecycle.run(()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const stopped=lifecycle.stop(new Error("input failed"));
  expect(lifecycle.stop()).toBe(stopped);
  await expect(lifecycle.run(async()=>42)).rejects.toThrow("shutting down");
  let finished=false;void stopped.then(()=>{finished=true;});
  await Promise.resolve();expect(finished).toBe(false);
  release();await operation;await stopped;
  expect(close).toHaveBeenCalledTimes(1);expect(process.exitCode).toBe(1);
});
it("bounds abnormal shutdown to ten seconds with a nonzero exit",async()=>{
  vi.useFakeTimers();
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  const exit=vi.spyOn(process,"exit").mockImplementation(()=>undefined as never);
  let release!:()=>void;
  const lifecycle=createLifecycle(async()=>new Promise<void>(resolve=>{release=resolve;}));
  const stopped=lifecycle.stop();
  await vi.advanceTimersByTimeAsync(9999);expect(exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(exit).toHaveBeenCalledWith(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("ten seconds"));
  release();await stopped;
});
