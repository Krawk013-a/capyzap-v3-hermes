"use client";

import { useEffect, useState } from "react";

type Update = {
  version: string;
  title: string;
  date: string;
  items: string[];
};

const LS_KEY = "capyzap-last-version";

/**
 * Modal "Novidades" — abre sozinho quando entra versão nova
 * (guarda a última vista no localStorage). Abre também pelo botão 🌟.
 */
export default function WhatsNew({ forceOpen, onClose }: { forceOpen?: boolean; onClose: () => void }) {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/changelog.json")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setUpdates(d.updates ?? []);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const latest = updates[0]?.version ?? null;

  // marca a versão como vista quando o modal é aberto/fechado com ela na tela
  useEffect(() => {
    if (!forceOpen && latest) {
      try {
        localStorage.setItem(LS_KEY, latest);
      } catch {}
    }
  }, [forceOpen, latest]);

  if (loading || updates.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="animate-slide-up max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-capy-dark">Novidades 🌿</h2>
            <p className="text-xs text-capy-dark/50">O que chegou de novo no CapyZap</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-capy-dark/40 hover:bg-capy-fur/10 hover:text-capy-dark"
            aria-label="Fechar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="space-y-5">
          {updates.map((u, i) => (
            <div key={u.version} className="rounded-xl bg-capy-sand/60 p-4 ring-1 ring-capy-fur/10">
              <div className="mb-2 flex items-center gap-2">
                {i === 0 && (
                  <span className="rounded-full bg-capy-green px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    novo
                  </span>
                )}
                <span className="text-sm font-extrabold text-capy-dark">{u.title}</span>
                <span className="ml-auto font-mono text-[11px] text-capy-dark/40">v{u.version}</span>
              </div>
              <ul className="space-y-1.5">
                {u.items.map((it) => (
                  <li key={it} className="flex gap-2 text-sm text-capy-dark/80">
                    <span className="shrink-0 text-capy-green">•</span>
                    {it}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-capy-dark/40">
                {new Date(u.date + "T12:00:00").toLocaleDateString("pt-BR")}
              </p>
            </div>
          ))}
        </div>

        <button onClick={onClose} className="capy-btn mt-5 w-full">
          Fechar
        </button>
      </div>
    </div>
  );
}

/** A versão atual do app (a mais nova do changelog). */
export function useWhatsNewSeen(): [boolean, (seen: boolean) => void] {
  const [unseen, setUnseen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/changelog.json")
      .then((r) => r.json())
      .then((d: { updates: Update[] }) => {
        if (!alive) return;
        const latest = d.updates?.[0]?.version;
        let last = "";
        try {
          last = localStorage.getItem(LS_KEY) ?? "";
        } catch {}
        if (latest && latest !== last) setUnseen(true);
        setChecked(true);
      })
      .catch(() => alive && setChecked(true));
    return () => {
      alive = false;
    };
  }, []);

  const markSeen = (seen: boolean) => {
    setUnseen(!seen);
  };
  return [checked && unseen, markSeen];
}
