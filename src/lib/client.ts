"use client";

/**
 * Thin client-side fetch wrapper. Unwraps the `{ data }` / `{ error }` envelope
 * used by the API routes and throws on non-2xx so callers can try/catch.
 */
export async function api<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return (payload?.data ?? payload) as T;
}

export const PLATFORM_META: Record<string, { label: string; color: string; icon: string }> = {
  TIKTOK: { label: "TikTok", color: "#25F4EE", icon: "🎵" },
  INSTAGRAM: { label: "Instagram", color: "#E1306C", icon: "📸" },
  FACEBOOK: { label: "Facebook", color: "#1877F2", icon: "📘" },
  YOUTUBE: { label: "YouTube", color: "#FF0000", icon: "▶️" },
};

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
