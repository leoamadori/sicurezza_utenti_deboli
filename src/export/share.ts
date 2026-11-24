import type { ShareResult } from "../domain/types";

export const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export function downloadFileLocally(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_REVOKE_DELAY_MS);
}

export async function shareFileSynchronously(
  file: File,
  title: string,
): Promise<ShareResult> {
  let canShareFile = false;
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function"
    ) {
      canShareFile = navigator.canShare({ files: [file] });
    }
  } catch {
    canShareFile = false;
  }

  if (canShareFile) {
    try {
      // Called directly inside user gesture with no prior async work
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
      // Technical share error -> fall back to local download
      try {
        downloadFileLocally(file);
        return "fallback_downloaded";
      } catch {
        return "error";
      }
    }
  }

  try {
    downloadFileLocally(file);
    return "fallback_downloaded";
  } catch {
    return "error";
  }
}
