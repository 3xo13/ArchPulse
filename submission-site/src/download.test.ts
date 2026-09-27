import { afterEach, expect, it, vi } from "vitest";
import { statSync } from "node:fs";
vi.mock("node:fs", () => ({ statSync: vi.fn() }));
import { downloadAvailable, downloadFilename } from "../vite.config";
afterEach(() => vi.clearAllMocks());
it("rejects missing, empty or non-file downloads", () => {
  const stat = vi.mocked(statSync);
  stat.mockImplementation(() => { throw new Error("ENOENT"); }); expect(downloadAvailable()).toBe(false);
  stat.mockReturnValue({ size: 0, isFile: () => true } as ReturnType<typeof statSync>); expect(downloadAvailable()).toBe(false);
  stat.mockReturnValue({ size: 100, isFile: () => false } as ReturnType<typeof statSync>); expect(downloadAvailable()).toBe(false);
});
it("enables an existing nonempty download", () => {
  vi.mocked(statSync).mockReturnValue({ size: 100, isFile: () => true } as ReturnType<typeof statSync>);
  expect(downloadAvailable()).toBe(true);
  expect(downloadFilename()).toBe("ArchPulse.rar");
});
it("falls back to ZIP when no RAR is supplied", () => {
  vi.mocked(statSync).mockImplementation(file => {
    if (String(file).endsWith(".rar")) throw new Error("ENOENT");
    return { size: 100, isFile: () => true } as ReturnType<typeof statSync>;
  });
  expect(downloadFilename()).toBe("archpulse.zip");
});
