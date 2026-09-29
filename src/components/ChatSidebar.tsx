"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  fetchChatList,
  searchUsers,
  startDm,
  createGroupRpc,
  signOut,
  getMyProfile,
} from "@/lib/data";
import { fmtChatStamp, sanitizeSearch } from "@/lib/format";
import { useToast } from "@/components/Toast";
import Avatar from "@/components/Avatar";
import { registerPush, isPushActive } from "@/lib/push";
import { playPlim, primeAudio, showLocalNotification } from "@/lib/sound";
import WhatsNew, { useWhatsNewSeen } from "@/components/WhatsNew";
import type { ChatListItem, Profile } from "@/types";

/**
 * Sidebar de conversas — sempre visível no desktop (layout de 2 colunas,
 * estilo WhatsApp Web) e tela cheia no mobile quando nenhuma conversa
 * está aberta. A rota só controla o painel direito.
 */
export default function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { pushToast } = useToast();

  // conversa ativa (null na lista) — p/ highlight e controle de toast
  const activeId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2] ?? null
    : null;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const [me, setMe] = useState<Profile | null>(null);
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Profile[]>([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFound, setGroupFound] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState<"checking" | "active" | "inactive" | "denied" | "unsupported" | "no-vapid" | "partial">("checking");
  const [pushWorking, setPushWorking] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [hasUnseen, markSeen] = useWhatsNewSeen();
  const chatsRef = useRef<ChatListItem[]>([]);
  chatsRef.current = chats;
  const pollTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const list = await fetchChatList();
    setChats(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    // cleanup síncrono (StrictMode-safe)
    let disposed = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      if (disposed) return;

      setMe(await getMyProfile());
      await refresh();
      if (disposed) return;

      // POLLING leve de fallback: se o websocket cair (rede de escola),
      // a lista continua atualizando a cada 12s.
      pollTimer.current = window.setInterval(async () => {
        if (!document.hidden) await refresh();
      }, 12000);

      // Realtime: nova mensagem em qualquer conversa → atualiza lista + toast
      channel = supabase
        .channel("capy-inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          async (payload) => {
            const m = payload.new as {
              conversation_id: string;
              sender_id: string;
              body: string | null;
              kind: string;
            };
            if (m.kind === "system" || m.sender_id === user.id) return;
            const isOpen =
              activeIdRef.current && m.conversation_id === activeIdRef.current;
            await refresh();
            if (isOpen) return; // não notifica a conversa que já está na tela
            const chat = chatsRef.current.find(
              (c) => c.conversation.id === m.conversation_id
            );
            if (!chat) return;
            // plim + notificação do sistema (mensagens fora da conversa aberta)
            void playPlim();
            const notifyBody =
              m.kind === "audio"
                ? "🎤 Áudio"
                : m.kind === "image"
                ? "📷 Foto"
                : (m.body ?? "").slice(0, 120);
            const notifyTitle = chat.conversation.is_group
              ? `${chat.conversation.name ?? "Grupo"}`
              : `${chat.otherUser?.first_name ?? "Alguém"} ${chat.otherUser?.last_name ?? ""}`;
            void showLocalNotification(
              `CapyZap — ${notifyTitle}`,
              notifyBody,
              `/chat/${m.conversation_id}`
            );
            if (chat.conversation.is_group) {
              const sender = chat.participants.find((p) => p.id === m.sender_id);
              pushToast({
                title: `${chat.conversation.name ?? "Grupo"} • ${sender?.first_name ?? "Alguém"}`,
                body:
                  m.kind === "audio"
                    ? "🎤 Áudio"
                    : m.kind === "image"
                    ? "📷 Foto"
                    : (m.body ?? "").slice(0, 90),
                avatar: sender?.avatar_url ?? null,
              });
            } else {
              pushToast({
                title: `${chat.otherUser?.first_name ?? "Alguém"} ${chat.otherUser?.last_name ?? ""}`,
                body:
                  m.kind === "audio"
                    ? "🎤 Áudio"
                    : m.kind === "image"
                    ? "📷 Foto"
                    : (m.body ?? "").slice(0, 90),
                avatar: chat.otherUser?.avatar_url ?? null,
              });
            }
          }
        )
        .subscribe();
    })();

    return () => {
      disposed = true;
      if (channel) getSupabaseBrowserClient().removeChannel(channel);
      if (pollTimer.current) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [refresh, router, pushToast]);

  // estado REAL do push: permissão + inscrição salva no banco
  useEffect(() => {
    let alive = true;
    (async () => {
      if (
        typeof Notification === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (alive) setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (alive) setPushState("denied");
        return;
      }
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        if (alive) setPushState("no-vapid");
        return;
      }
      const active = await isPushActive();
      if (alive) setPushState(active ? "active" : "inactive");
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleEnablePush() {
    setPushWorking(true);
    try {
      const result = await registerPush();
      if (result === "ok") {
        setPushState("active");
        pushToast({
          title: "Notificações ativadas! 🔔",
          body: "Você recebe avisos de mensagens novas.",
        });
      } else if (result === "denied") {
        setPushState("denied");
      } else if (result === "table-missing") {
        setPushState("partial");
      } else if (result === "unsupported") {
        setPushState("unsupported");
      } else {
        setPushState("inactive"); // falhou → continua oferecendo, mas sem loop
      }
    } finally {
      setPushWorking(false);
    }
  }

  // modal de novidades: abre sozinho quando há versão não vista
  useEffect(() => {
    if (hasUnseen) {
      setWhatsNewOpen(true);
      markSeen(true);
    }
  }, [hasUnseen, markSeen]);

  // debounce da busca de pessoas
  useEffect(() => {
    const q = sanitizeSearch(search).trim();
    if (!q) {
      setFound([]);
      return;
    }
    const t = setTimeout(async () => {
      setFound(await searchUsers(q));
    }, 280);
    return () => clearTimeout(t);
  }, [search]);

  // busca dentro do modal de grupo
  useEffect(() => {
    const q = sanitizeSearch(groupSearch).trim();
    if (!q) {
      setGroupFound([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await searchUsers(q);
      setGroupFound(res.filter((p) => !groupMembers.some((g) => g.id === p.id)));
    }, 280);
    return () => clearTimeout(t);
  }, [groupSearch, groupMembers]);

  async function handleStartDm(userId: string) {
    setBusy(true);
    try {
      const convoId = await startDm(userId);
      if (convoId) router.push(`/chat/${convoId}`);
    } catch {
      pushToast({ title: "Ops!", body: "Não foi possível abrir a conversa." });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateGroup() {
    if (!groupName.trim() || groupMembers.length === 0) return;
    setBusy(true);
    try {
      const id = await createGroupRpc(
        groupName.trim(),
        groupMembers.map((m) => m.id)
      );
      if (id) {
        setGroupOpen(false);
        setGroupName("");
        setGroupMembers([]);
        setGroupSearch("");
        await refresh();
        router.push(`/chat/${id}`);
      }
    } catch {
      pushToast({ title: "Ops!", body: "Não foi possível criar o grupo." });
    } finally {
      setBusy(false);
    }
  }

  const headerName = useMemo(
    () => (me ? `${me.first_name} ${me.last_name}`.trim() : "…"),
    [me]
  );

  return (
    <aside className="flex h-full w-full flex-col border-r border-capy-fur/15 bg-capy-sand">
      {/* topo */}
      <header className="flex items-center justify-between bg-capy-dark px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/capy.svg" alt="" className="h-8 w-8" />
          <h1 className="text-lg font-extrabold">
            Capy<span className="text-capy-green">Zap</span>
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/suggestions"
            title="Sugestões"
            className="rounded-lg p-2 hover:bg-white/10"
          >
            💡
          </Link>
          <button
            onClick={() => setWhatsNewOpen(true)}
            title="Novidades"
            className="relative rounded-lg p-2 hover:bg-white/10"
          >
            🌟
            {hasUnseen && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-capy-accent ring-2 ring-capy-dark" />
            )}
          </button>
          <button
            onClick={() => setGroupOpen(true)}
            title="Novo grupo"
            className="rounded-lg p-2 hover:bg-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
          <Link
            href="/profile"
            title="Perfil"
            className="rounded-lg p-2 hover:bg-white/10"
          >
            <Avatar profile={me} size={28} />
          </Link>
        </div>
      </header>

      {/* busca */}
      <div className="bg-capy-sand px-3 pt-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar pessoas (@handle) ou nome…"
          className="capy-input mb-3"
        />
      </div>

      {/* resultados de busca */}
      {search.trim() !== "" ? (
        <div className="nice-scroll flex-1 overflow-y-auto">
          {found.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-capy-dark/50">
              Ninguém encontrado com “{search}”. 🦫
            </p>
          ) : (
            found.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => handleStartDm(p.id)}
                className="flex w-full items-center gap-3 border-b border-capy-fur/10 bg-white px-4 py-3 text-left transition hover:bg-capy-bubble/40"
              >
                <Avatar profile={p} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-capy-dark">
                    {p.first_name} {p.last_name}
                  </p>
                  <p className="truncate text-xs text-capy-dark/50">{p.handle}</p>
                </div>
                <span className="ml-auto rounded-full bg-capy-green px-3 py-1 text-xs font-bold text-white">
                  conversar
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        /* lista de conversas */
        <div className="nice-scroll flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-capy-dark/50">
              Carregando conversas…
            </p>
          ) : chats.length === 0 ? (
            <div className="px-6 py-12 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/capy.svg" alt="" className="mx-auto mb-4 h-20 w-20 opacity-80" />
              <p className="font-semibold text-capy-dark">Nenhuma conversa ainda</p>
              <p className="mt-1 text-sm text-capy-dark/50">
                Busca alguém acima pra começar a conversar! 🌿
              </p>
            </div>
          ) : (
            chats.map((c) => {
              const title = c.conversation.is_group
                ? c.conversation.name ?? "Grupo"
                : `${c.otherUser?.first_name ?? "?"} ${c.otherUser?.last_name ?? ""}`;
              const preview = c.lastMessage
                ? c.lastMessage.deleted
                  ? "🚫 mensagem apagada"
                  : c.lastMessage.kind === "audio"
                  ? "🎤 Áudio"
                  : c.lastMessage.kind === "image"
                  ? "📷 Foto"
                  : c.lastMessage.kind === "system"
                  ? c.lastMessage.body ?? ""
                  : (c.lastMessage.body ?? "").slice(0, 60)
                : "Conversa nova 🌱";
              const isActive = c.conversation.id === activeId;
              return (
                <Link
                  key={c.conversation.id}
                  href={`/chat/${c.conversation.id}`}
                  className={`flex items-center gap-3 border-b border-capy-fur/10 px-4 py-3 transition ${
                    isActive
                      ? "bg-capy-bubble/70"
                      : "hover:bg-capy-bubble/40"
                  }`}
                >
                  <Avatar
                    profile={c.conversation.is_group ? null : c.otherUser}
                    group={c.conversation.is_group}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold text-capy-dark">{title}</p>
                      <span className="shrink-0 text-[11px] text-capy-dark/45">
                        {c.lastMessage
                          ? fmtChatStamp(c.lastMessage.created_at)
                          : fmtChatStamp(c.conversation.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-capy-dark/60">{preview}</p>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-capy-green px-1.5 text-[11px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {/* card: ativar notificações push — só aparece quando dá pra ativar */}
      {pushState === "inactive" && (
        <div className="border-t border-capy-fur/10 bg-capy-bubble/50 px-4 py-3">
          <p className="text-xs font-semibold text-capy-deep">
            🔔 Quer receber aviso de mensagens novas?
          </p>
          <button
            onClick={handleEnablePush}
            disabled={pushWorking}
            className="mt-2 w-full rounded-lg bg-capy-green px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            {pushWorking ? "Ativando…" : "Ativar notificações"}
          </button>
        </div>
      )}
      {pushState === "partial" && (
        <div className="border-t border-capy-fur/10 bg-capy-bubble/50 px-4 py-3">
          <p className="text-xs font-semibold text-capy-deep">
            🔔 Quase lá! Roda o SQL do push no Supabase pra fechar.
          </p>
        </div>
      )}

      {/* rodapé: sair */}
      <footer className="border-t border-capy-fur/10 px-4 py-2">
        <button
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          className="text-xs font-medium text-capy-dark/40 hover:text-capy-danger"
        >
          Sair da conta ({headerName})
        </button>
      </footer>

      {/* modal: novidades */}
      {whatsNewOpen && <WhatsNew onClose={() => setWhatsNewOpen(false)} />}

      {/* modal: novo grupo */}
      {groupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4"
          onClick={() => setGroupOpen(false)}
        >
          <div
            className="animate-slide-up w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-capy-dark">Novo grupo 👥</h2>
            <p className="mb-4 text-xs text-capy-dark/50">
              Dá um nome e adiciona as pessoas.
            </p>

            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nome do grupo (ex.: Turma da escola)"
              className="capy-input mb-3"
            />

            {groupMembers.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {groupMembers.map((m) => (
                  <span
                    key={m.id}
                    className="flex items-center gap-1 rounded-full bg-capy-bubble px-2 py-1 text-xs font-semibold text-capy-deep"
                  >
                    {m.first_name}
                    <button
                      onClick={() =>
                        setGroupMembers((ms) => ms.filter((x) => x.id !== m.id))
                      }
                      className="text-capy-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Buscar pessoas pra adicionar…"
              className="capy-input mb-3"
            />

            <div className="nice-scroll max-h-48 overflow-y-auto rounded-xl border border-capy-fur/15">
              {groupFound.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setGroupMembers((ms) => [...ms, p]);
                    setGroupSearch("");
                    setGroupFound([]);
                  }}
                  className="flex w-full items-center gap-3 border-b border-capy-fur/10 px-3 py-2 text-left hover:bg-capy-bubble/40"
                >
                  <Avatar profile={p} size={36} />
                  <span className="font-medium text-capy-dark">
                    {p.first_name} {p.last_name}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-capy-green">
                    + adicionar
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => setGroupOpen(false)} className="capy-btn-secondary flex-1">
                Cancelar
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={busy || !groupName.trim() || groupMembers.length === 0}
                className="capy-btn flex-1"
              >
                {busy ? "Criando…" : "Criar grupo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
