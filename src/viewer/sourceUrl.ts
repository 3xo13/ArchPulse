import { repositoryPath } from "./report";

export function sourceUrl(repository: string, revision: string, file: string): string | undefined {
  if (!revision.trim() || !repositoryPath.safeParse(file).success) return;
  try {
    const url = new URL(repository);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) return;
    if (/[\u0000-\u0020]/.test(revision) || revision.split("/").some(part => !part || part === "." || part === "..")) return;
    return `${url.origin}${url.pathname.replace(/\/$/, "").replace(/\.git$/, "")}/blob/${encodeURIComponent(revision)}/${file.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`;
  } catch { return; }
}
export const revisionFromMarker = (marker?: string): string => marker && /^[0-9a-f]{7,40}$/i.test(marker) ? marker : "";
