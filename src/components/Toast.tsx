"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Toast = {
  id: number;
  title: string;
  body?: string;
  avatar?: string | null;
};

type ToastCtx = {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ toasts, pushToast, dismiss }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-3">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto w-full max-w-sm animate-slide-up rounded-xl bg-capy-dark/95 px-4 py-3 text-left shadow-xl ring-1 ring-white/10 backdrop-blur"
          >
            <div className="flex items-center gap-3">
              {t.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-capy-green text-lg">
                  💬
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{t.title}</p>
                {t.body ? (
                  <p className="truncate text-xs text-white/75">{t.body}</p>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast deve estar dentro de ToastProvider");
  return ctx;
}
