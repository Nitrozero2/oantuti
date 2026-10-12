/**
 * lib/backend.ts
 * Helper kiểm tra backend (máy cá nhân) có online không,
 * và wrapper fetch với timeout ngắn để tránh hang.
 *
 * Backend chạy trên máy cá nhân, public qua Cloudflare Tunnel.
 * Khi máy tắt, mọi request sẽ timeout/fail — file này đảm bảo
 * frontend trả về lỗi thân thiện thay vì crash hay treo mãi.
 */

export const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

// Timeout dùng cho health check (ngắn để check nhanh)
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

// Timeout mặc định cho các request nghiệp vụ
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// Thông báo lỗi thân thiện hiển thị cho user
export const BACKEND_OFFLINE_MESSAGE =
  "Backend đang offline. Tính năng này cần máy chủ cá nhân đang chạy. " +
  "Vui lòng thử lại sau khi máy chủ được bật.";

/**
 * Kiểm tra backend có online không bằng cách gọi /health.
 * Trả về true nếu online, false nếu offline/timeout.
 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT_MS,
    );
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: controller.signal,
      // Không dùng cache — luôn check thực
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
 *
 * Trả về { ok: true, data } hoặc { ok: false, status, error }
 * — KHÔNG ném exception ra ngoài.
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
      } catch {
        // ignore parse error
      }
      return { ok: false, status: res.status, error: errorMsg, isOffline: false };
    }

    const data = await res.json();
    return { ok: true, data, status: res.status };
  } catch (err) {
    clearTimeout(timer);

    // AbortError = timeout; TypeError fetch failed = offline/DNS fail
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

/**
 * Tiện ích: tạo NextResponse lỗi backend offline chuẩn.
 * Dùng trong các Next.js API route.
 */
export function backendOfflineResponse(detail?: string) {
  return {
    error: detail ?? BACKEND_OFFLINE_MESSAGE,
    backend_offline: true,
  };
}
