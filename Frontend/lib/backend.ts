/**
 * lib/backend.ts
 *
 * BACKEND_URL đọc từ environment variable:
 *   1. BACKEND_URL (server-side)
 *   2. NEXT_PUBLIC_BACKEND_URL (client-side fallback)
 *   3. "http://localhost:8000" (dev local)
 *
 * Cập nhật URL: thay đổi env var trên Vercel → redeploy (hoặc dùng instant rollout).
 */

// ─── Lấy BACKEND_URL ─────────────────────────────────────────────────────────

const BACKEND_URL =
  (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000")
    .replace(/\/+$/, ""); // bỏ trailing slash

export function getBackendUrl(): string {
  return BACKEND_URL;
}

// Giữ async signature để không phải sửa tất cả caller
export async function getBackendUrlAsync(): Promise<string> {
  return BACKEND_URL;
}

// ─── Timeout & error helpers ─────────────────────────────────────────────────

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const BACKEND_OFFLINE_MESSAGE =
  "Backend đang offline. Tính năng này cần máy chủ cá nhân đang chạy. " +
  "Vui lòng thử lại sau khi máy chủ được bật.";

/**
 * Kiểm tra backend có online không bằng cách gọi /health.
 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * fetch() wrapper với timeout và error handling thân thiện.
 */
export async function backendFetch(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<
  | { ok: true; data: unknown; status: number }
  | { ok: false; status: number; error: string; isOffline: boolean }
> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers ?? {}),
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const body = await res.json() as { detail?: string; error?: string };
        errorMsg = body.detail ?? body.error ?? errorMsg;
      } catch { /* ignore */ }
      return { ok: false, status: res.status, error: errorMsg, isOffline: false };
    }

    const data = await res.json();
    return { ok: true, data, status: res.status };
  } catch (err) {
    clearTimeout(timer);

    const isOffline =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.includes("fetch failed") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("network") ||
        err.message.includes("Failed to fetch"));

    return {
      ok: false,
      status: 503,
      error: isOffline ? BACKEND_OFFLINE_MESSAGE : String(err),
      isOffline,
    };
  }
}

export function backendOfflineResponse(detail?: string) {
  return {
    error: detail ?? BACKEND_OFFLINE_MESSAGE,
    backend_offline: true,
  };
}
