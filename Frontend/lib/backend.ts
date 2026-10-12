/**
 * lib/backend.ts
 *
 * BACKEND_URL được đọc theo thứ tự ưu tiên:
 *   1. DB (bảng app_settings, key = 'backend_url')  ← admin cập nhật từ dashboard
 *   2. Env var BACKEND_URL                           ← fallback khi DB chưa có giá trị
 *   3. "http://localhost:8000"                       ← dev local
 *
 * Cache in-memory 60s để không query DB mỗi request.
 * Khi admin cập nhật URL mới → cache tự hết hạn trong vòng 60s, không cần redeploy.
 */

import { sql } from "@/lib/db";

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 giây

let _cachedUrl: string | null = null;
let _cacheExpiry: number = 0;

/** Xóa cache ngay (gọi sau khi admin lưu URL mới). */
export function invalidateBackendUrlCache() {
  _cachedUrl = null;
  _cacheExpiry = 0;
}

// ─── Lấy BACKEND_URL ─────────────────────────────────────────────────────────

/** Env var fallback (vẫn giữ để dev local hoặc khi DB chưa seed). */
const ENV_BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

/**
 * Trả về BACKEND_URL hiện tại (DB → env → localhost).
 * Kết quả được cache 60s.
 */
export async function getBackendUrl(): Promise<string> {
  const now = Date.now();

  // Cache còn hạn
  if (_cachedUrl !== null && now < _cacheExpiry) {
    return _cachedUrl;
  }

  // Query DB
  try {
    const rows = await sql`
      SELECT value FROM app_settings WHERE key = 'backend_url' LIMIT 1
    `;
    const dbValue = (rows[0] as { value: string } | undefined)?.value?.trim();

    if (dbValue) {
      _cachedUrl = dbValue.replace(/\/+$/, ""); // bỏ trailing slash
      _cacheExpiry = now + CACHE_TTL_MS;
      return _cachedUrl;
    }
  } catch {
    // DB lỗi hoặc bảng chưa được tạo → dùng fallback
  }

  // Fallback về env var
  _cachedUrl = ENV_BACKEND_URL.replace(/\/+$/, "");
  _cacheExpiry = now + CACHE_TTL_MS;
  return _cachedUrl;
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
    const baseUrl = await getBackendUrl();
    if (!baseUrl) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/health`, {
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
 * Tự resolve BACKEND_URL từ DB mỗi lần gọi (dùng cache).
 */
export async function backendFetch(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<
  | { ok: true; data: unknown; status: number }
  | { ok: false; status: number; error: string; isOffline: boolean }
> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;

  const baseUrl = await getBackendUrl();

  if (!baseUrl) {
    return {
      ok: false,
      status: 503,
      error: "BACKEND_URL chưa được cấu hình. Vào Admin → Settings để cập nhật.",
      isOffline: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
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
