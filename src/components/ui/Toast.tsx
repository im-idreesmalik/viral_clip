"use client";

/**
 * Minimal toast notifications. Wrap a subtree in <ToastProvider> and call
 * useToast() to push success/error/info messages — a polished replacement for
 * window.alert(). Auto-dismisses; click ✕ to dismiss early.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++counter;
      setToasts((list) => [...list, { id, kind, message }]);
      setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const api: ToastApi = {
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end sm:p-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur-md ${KIND_STYLES[t.kind]}`}
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">
              {KIND_ICONS[t.kind]}
            </span>
            <span className="flex-1 leading-snug text-ink-100">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-ink-400 transition-colors hover:text-ink-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const KIND_ICONS: Record<ToastKind, string> = { success: "✓", error: "!", info: "i" };
const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-500/40 bg-emerald-500/15",
  error: "border-red-500/40 bg-red-500/15",
  info: "border-brand-500/40 bg-brand-500/15",
};

/**
 * Access toast functions. Falls back to window.alert for errors when used
 * outside a ToastProvider (e.g. on public pages), so messages are never lost.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  return {
    success: () => {},
    error: (m) => {
      if (typeof window !== "undefined") window.alert(m);
    },
    info: () => {},
  };
}
