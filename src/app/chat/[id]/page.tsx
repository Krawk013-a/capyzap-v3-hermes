"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  fetchMessages,
  getMyProfile,
  markConversationRead,
  sendTextMessage,
  sendAudioMessage,
  sendImageMessage,
  getSignedAudioUrl,
  getSignedImageUrl,
  editMessage,
  heartbeatSeen,
} from "@/lib/data";
import { fmtTime, fmtDayDivider, fmtDuration, fmtLastSeen, pickRecorderMime, audioExtForMime } from "@/lib/format";
import { playPlim, showLocalNotification } from "@/lib/sound";
import Avatar from "@/components/Avatar";
import type { Message, Profile } from "@/types";

type ConvoInfo = {
  is_group: boolean;
  name: string | null;
  members: Profile[];
  other: Profile | null;
};

export default function ChatRoom() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const convoId = params.id;

  const [me, setMe] = useState<Profile | null>(null);
  const [info, setInfo] = useState<ConvoInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [otherTyping, setOtherTyping] = useState<string | null>(null); // nome de quem digita
  const [otherSeen, setOtherSeen] = useState<string | null>(null); // last_seen do outro
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<
    | {
        rec: MediaRecorder;
        chunks: Blob[];
        timer: number;
        cancelled?: boolean;
        finalDuration?: number;
      }
    | null
  >(null);
  const lastReadOkRef = useRef<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollTimer = useRef<number | null>(null);
  const lastStampRef = useRef<string>("");
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // carrega tudo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const myProfile = await getMyProfile();
      if (cancelled) return;
      setMe(myProfile);

      // dados da conversa
      const { data: convo } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", convoId)
        .single();
      if (!convo) {
        router.replace("/chat");
        return;
      }

      const { data: parts } = await supabase
        .from("participants")
        .select("user_id, last_read_at, profiles(*)")
        .eq("conversation_id", convoId);
      const members = (parts ?? []).map((p) => p.profiles as unknown as Profile);
      const others = members.filter((p) => p.id !== user.id);
      // último "li" dos OUTROS → define ticks verdes das minhas msgs
      const othersRead = (parts ?? [])
        .filter((p) => p.user_id !== user.id)
        .map((p) => p.last_read_at as string)
        .sort();
      setOtherLastRead(othersRead.length ? othersRead[othersRead.length - 1] : null);

      if (cancelled) return;
      setInfo({
        is_group: convo.is_group,
        name: convo.name,
        members,
        other: convo.is_group ? null : others[0] ?? null,
      });

      const initial = await fetchMessages(convoId);
      if (cancelled) return;
      setMessages(initial);
      if (initial.length > 0) {
        lastStampRef.current = new Date(
          initial[initial.length - 1].created_at
        ).toISOString();
      }
      setLoading(false);
      requestAnimationFrame(() => scrollToBottom(false));

      await markConversationRead(convoId);
      lastReadOkRef.current = convoId;

      // realtime da conversa (channel guardado p/ cleanup síncrono)
      if (cancelled) return; // componente desmontou enquanto carregava
      // === PRESENCE: "digitando…" + online/último visto ===
      const room = supabase.channel(`capy-presence-${convoId}`, {
        config: { presence: { key: user.id } },
      });

      room
        .on("presence", { event: "sync" }, () => {
          const state = room.presenceState() as Record<string, unknown[]>;
          const others = Object.keys(state).filter((k) => k !== user.id);
          if (others.length > 0) {
            // alguém do outro lado está na sala — mostra "online"
            const other = others[0];
            // pega last_seen real do perfil (pra quando sair, mostrar "visto às...")
            void supabase
              .from("profiles")
              .select("first_name, last_seen_at")
              .eq("id", other)
              .single()
              .then(({ data }) => {
                if (data) setOtherSeen(data.last_seen_at);
              });
          }
        })
        .on("presence", { event: "join" }, ({ key }) => {
          if (key !== user.id) setOtherSeen("ONLINE");
        })
        .on("presence", { event: "leave" }, ({ key }) => {
          if (key !== user.id) {
            // saiu — atualiza o last_seen (heartbeat dele deixou fresco)
            void supabase
              .from("profiles")
              .select("last_seen_at")
              .eq("id", key)
              .single()
              .then(({ data }) => {
                if (data) setOtherSeen(data.last_seen_at);
              });
            setOtherTyping(null);
          }
        })
        // broadcast: digitando…
        .on("broadcast", { event: "typing" }, (payload) => {
          const d = payload as unknown as { user_id: string; name: string; typing: boolean };
          if (d.user_id === user.id) return;
          setOtherTyping(d.typing ? d.name : null);
          if (d.typing) {
            // apaga o "digitando" sozinho após 4s sem novo sinal
            if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
            typingTimerRef.current = window.setTimeout(() => setOtherTyping(null), 4000);
          }
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await room.track({ online_at: new Date().toISOString() });
            await heartbeatSeen();
          }
        });

      // heartbeat de last_seen a cada 60s enquanto a sala está aberta
      const hbTimer = window.setInterval(() => {
        void heartbeatSeen();
      }, 60000);

      // mensagem EDITADA por alguém → atualiza na tela
      const chUpd = supabase
        .channel(`capy-edits-${convoId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${convoId}` },
          (payload) => {
            const m = payload.new as Message;
            setMessages((prev) =>
              prev.map((x) =>
                x.id === m.id
                  ? { ...x, body: m.body, edited_at: m.edited_at, deleted: m.deleted }
                  : x
              )
            );
          }
        )
        .subscribe();

      // POLLING de backup (rede de escola mata websocket com frequência):
      // a cada 8s puxa o que vier depois da última mensagem conhecida.
      pollTimer.current = window.setInterval(async () => {
        const { data } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", convoId)
          .gt("created_at", lastStampRef.current)
          .order("created_at", { ascending: true })
          .limit(50);
        if (data && data.length > 0) {
          let latest = lastStampRef.current;
          const freshIds = new Set(messagesRef.current.map((x) => x.id));
          for (const m of data as Message[]) {
            const isNew = !freshIds.has(m.id); // já estava na tela? não é nova
            mergeMessage(m); // dedupe por id: não duplica
            if (isNew && m.sender_id !== user.id) {
              markConversationRead(convoId);
              if (document.hidden) {
                void playPlim(); // só toca UMA vez por mensagem nova
                void showLocalNotification(
                  "CapyZap — nova mensagem",
                  m.kind === "audio"
                    ? "🎤 Áudio"
                    : m.kind === "image"
                    ? "📷 Foto"
                    : (m.body ?? "").slice(0, 120),
                  `/chat/${convoId}`
                );
              }
            }
            const t = new Date(m.created_at).toISOString();
            if (t > latest) latest = t;
          }
          lastStampRef.current = latest;
          requestAnimationFrame(() => scrollToBottom());
        }
      }, 8000);

      const ch = supabase
        .channel(`capy-room-${convoId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convoId}` },
          (payload) => {
            const m = payload.new as Message;
            mergeMessage(m); // dedupe: a otimista (mesmo id) não duplica
            const t = new Date(m.created_at).toISOString();
            if (t > lastStampRef.current) lastStampRef.current = t;
            if (m.sender_id !== user.id) {
              markConversationRead(convoId);
              // plim + notificação do sistema (só se a aba não está visível)
              if (document.hidden) {
                void playPlim();
                const title = info?.is_group
                  ? `${info.name ?? "Grupo"} • nova mensagem`
                  : `${info?.other?.first_name ?? "Alguém"} te mandou mensagem`;
                const body =
                  m.kind === "audio"
                    ? "🎤 Áudio"
                    : m.kind === "image"
                    ? "📷 Foto"
                    : (m.body ?? "").slice(0, 120);
                void showLocalNotification(title, body, `/chat/${convoId}`);
              }
            }
            requestAnimationFrame(() => scrollToBottom());
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "participants", filter: `conversation_id=eq.${convoId}` },
          (payload) => {
            // alguém marcou leitura → atualiza ticks das minhas mensagens
            const p = payload.new as { user_id: string; last_read_at: string };
            if (p.user_id !== user.id) {
              setOtherLastRead((prev) =>
                !prev || p.last_read_at > prev ? p.last_read_at : prev
              );
            }
          }
        )
        .subscribe();
      channelRef.current = ch;
    })();

    return () => {
      cancelled = true;
      const supa = getSupabaseBrowserClient();
      const ch = channelRef.current;
      if (ch) supa.removeChannel(ch);
      channelRef.current = null;
      supa.removeChannel(supa.channel(`capy-presence-${convoId}`));
      supa.removeChannel(supa.channel(`capy-edits-${convoId}`));
      if (pollTimer.current) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [convoId, router, scrollToBottom]);

  /** Usuário escolheu uma foto → mostra preview antes de enviar. */
  function handlePickImage(f: File | null) {
    setError(null);
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) {
      setError("Só aceito PNG, JPG, WEBP ou GIF 🦫");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("Foto muito grande — o limite é 5MB.");
      return;
    }
    setPendingImage(f);
    setImagePreview(URL.createObjectURL(f));
  }

  /** Sobe a foto e cria a mensagem. */
  async function handleSendImage() {
    if (!pendingImage) return;
    setUploadingImage(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const ext = pendingImage.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${convoId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("images")
        .upload(path, pendingImage, { contentType: pendingImage.type });
      if (upErr) {
        console.error("[imagem] upload:", upErr.message);
        if (upErr.message.includes("not found") || upErr.message.includes("Bucket not found")) {
          setError("O bucket \"images\" não existe no Supabase — rode o migration-v2.sql 🦫");
        } else if (upErr.message.includes("policy") || upErr.message.includes("row-level")) {
          setError("Sem permissão no bucket \"images\" — rode o migration-v2.sql 🦫");
        } else {
          setError("Falha ao subir a foto: " + upErr.message);
        }
        return;
      }
      const msg = await sendImageMessage(convoId, path);
      mergeMessage(msg);
      setPendingImage(null);
      setImagePreview(null);
      requestAnimationFrame(() => scrollToBottom());
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      console.error("[imagem] envio:", m);
      if (m.includes("column") || m.includes("image_url")) {
        setError("Falta a coluna image_url — rode o migration-v2.sql no SQL Editor 🦫");
      } else {
        setError("Falha ao enviar a foto 🦫 tenta de novo.");
      }
    } finally {
      setUploadingImage(false);
    }
  }

  /** Adiciona mensagem se ainda não existir (id é único). */
  function mergeMessage(m: Message) {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id) ? prev : [...prev, m]
    );
  }

  /** Emite "digitando…" no máximo a cada 2s enquanto digita. */
  function emitTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const supabase = getSupabaseBrowserClient();
    void supabase.channel(`capy-presence-${convoId}`).send({
      type: "broadcast",
      event: "typing",
      payload: {
        user_id: me?.id ?? "",
        name: me?.first_name ?? "Alguém",
        typing: true,
      },
    });
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendTextMessage(convoId, body, replyTo?.id ?? null);
      mergeMessage(msg); // aparece na hora, independente do Realtime
      setText("");
      setReplyTo(null);
      requestAnimationFrame(() => scrollToBottom());
    } catch {
      setError("Falha no envio — a internet da escola falhou? Tenta de novo 🦫");
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const state = { rec, chunks: [] as Blob[], timer: 0, cancelled: false, finalDuration: 0 };
      recRef.current = state;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) state.chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (state.cancelled) return; // usuário cancelou — não sobe nada
        const blob = new Blob(state.chunks, { type: rec.mimeType || mime });
        if (blob.size < 1000) {
          setError("Gravação muito curtinha 🦫 segura o botão e fala algo.");
          return;
        }
        await uploadAudio(blob, state.finalDuration);
      };
      rec.start(250);
      const timer = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
      state.timer = timer;
      setRecording(true);
      setRecSeconds(0);
    } catch {
      setError("Não consegui acessar o microfone — libera a permissão no navegador.");
    }
  }

  async function uploadAudio(blob: Blob, duration: number) {
    const supabase = getSupabaseBrowserClient();
    const ext = audioExtForMime(blob.type || "audio/webm");
    const path = `${convoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("audio")
      .upload(path, blob, { contentType: blob.type || "audio/webm" });
    if (upErr) {
      setError("Falha ao subir o áudio: " + upErr.message);
      return;
    }
    try {
      const msg = await sendAudioMessage(convoId, path, Math.max(1, duration));
      mergeMessage(msg); // aparece na hora
      requestAnimationFrame(() => scrollToBottom());
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m.includes("audio_duration") || m.includes("column")) {
        setError("Roda o migration v2/v3 no SQL Editor 🦫");
      } else {
        setError("Falha ao enviar áudio 🦫");
      }
    }
  }

  const recSecondsRef = useRef(0);
  useEffect(() => {
    recSecondsRef.current = recSeconds;
  }, [recSeconds]);

  async function stopRecording(cancel = false) {
    const r = recRef.current;
    if (!r) return;
    window.clearInterval(r.timer);
    setRecording(false);
    recRef.current = null;
    if (cancel) {
      r.cancelled = true;
      r.rec.onstop = null; // impede o upload no onstop
      try {
        r.rec.stream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        r.rec.stop();
      } catch {}
      return;
    }
    // NÃO zera os chunks aqui! O onstop precisa deles pra montar o blob.
    // Marca a duração ANTES do stop (recSeconds para de contar agora).
    r.finalDuration = recSecondsRef.current;
    r.rec.stop(); // onstop dispara o upload com o blob completo
  }

  async function handleSaveEdit() {
    if (!editingMsg) return;
    const body = editDraft.trim();
    if (!body) return;
    try {
      const result = await editMessage(editingMsg.id, body);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === editingMsg.id
            ? {
                ...x,
                body,
                edited_at: result.full
                  ? new Date().toISOString()
                  : x.edited_at ?? null,
              }
            : x
        )
      );
      setEditingMsg(null);
      setEditDraft("");
      if (!result.full) {
        // edição funcionou, mas sem o selo "editada" (migration-v3 pendente)
        setError("Edição salva! Selo \"editada\" chega depois de rodar o migration-v3.sql 🦫");
      }
    } catch {
      setError("Não consegui salvar a edição 🦫");
    }
  }

  async function handleDelete(m: Message) {
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from("messages")
      .update({ deleted: true, body: null, audio_url: null })
      .eq("id", m.id);
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id ? { ...x, deleted: true, body: null, audio_url: null } : x
      )
    );
  }

  const title = info
    ? info.is_group
      ? info.name ?? "Grupo"
      : `${info.other?.first_name ?? "?"} ${info.other?.last_name ?? ""}`
    : "…";

  return (
    <section className="flex h-full w-full min-w-0 flex-col bg-capy-sand">
      {/* header */}
      <header className="flex items-center gap-3 bg-capy-dark px-3 py-2.5 text-white shadow-md">
        <button
          onClick={() => router.push("/chat")}
          className="rounded-lg p-1.5 hover:bg-white/10 md:hidden"
          aria-label="Voltar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <Avatar
          profile={info?.is_group ? null : info?.other}
          group={info?.is_group}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{title}</p>
          {info?.is_group ? (
            <p className="truncate text-xs text-white/60">
              {otherTyping
                ? `${otherTyping} está digitando…`
                : `${info.members.length} ${info.members.length === 1 ? "membro" : "membros"}`}
            </p>
          ) : (
            <p className="truncate text-xs text-white/60">
              {otherTyping
                ? "digitando…"
                : otherSeen === "ONLINE"
                ? "online"
                : fmtLastSeen(otherSeen)}
            </p>
          )}
        </div>
      </header>

      {/* mensagens */}
      <section className="chat-bg nice-scroll relative flex-1 overflow-y-auto px-3 py-4 md:px-8">
        {loading ? (
          <p className="py-10 text-center text-sm text-capy-dark/50">
            Carregando mensagens…
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                m={m}
                prev={messages[i - 1]}
                mine={m.sender_id === me?.id}
                read={otherLastRead ? new Date(m.created_at) <= new Date(otherLastRead) : false}
                replyBody={replyQuoteOf(m, messages)}
                senderName={
                  info?.is_group
                    ? info.members.find((x) => x.id === m.sender_id)
    ? `${info.members.find((x) => x.id === m.sender_id)!.first_name} ${info.members.find((x) => x.id === m.sender_id)!.last_name}`
                    : "Alguém"
                    : null
                }
                onReply={() => setReplyTo(m)}
                onEdit={() => {
                  setEditingMsg(m);
                  setEditDraft(m.body ?? "");
                }}
                onDelete={() => handleDelete(m)}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </section>

      {/* editor de mensagem */}
      {editingMsg && (
        <div className="flex items-center gap-2 border-t border-capy-fur/15 bg-capy-sanddark/60 px-4 py-2">
          <span className="text-xs">✏️</span>
          <input
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSaveEdit();
              }
              if (e.key === "Escape") {
                setEditingMsg(null);
                setEditDraft("");
              }
            }}
            autoFocus
            className="capy-input flex-1 py-2 text-sm"
            placeholder="Editar mensagem…"
          />
          <button
            onClick={() => void handleSaveEdit()}
            className="rounded-full bg-capy-green px-3 py-1.5 text-xs font-bold text-white"
          >
            Salvar
          </button>
          <button
            onClick={() => {
              setEditingMsg(null);
              setEditDraft("");
            }}
            className="rounded-full bg-capy-fur/15 px-3 py-1.5 text-xs font-bold text-capy-dark"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* resposta ativa */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-capy-fur/15 bg-capy-bubble/60 px-4 py-2">
          <span className="text-xs">↩️</span>
          <div className="min-w-0 flex-1 truncate text-xs text-capy-dark/70">
            Respondendo:{" "}
            <b>
              {replyTo.kind === "audio" ? "🎤 áudio" : (replyTo.body ?? "mensagem")}
            </b>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-capy-danger font-bold">
            ×
          </button>
        </div>
      )}

      {/* erro */}
      {error && (
        <div className="bg-capy-danger/10 px-4 py-2 text-center text-xs text-capy-danger">
          {error}
        </div>
      )}

      {/* composer */}
      <footer className="flex items-end gap-2 border-t border-capy-fur/15 bg-capy-sand px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {recording ? (
          <div className="flex flex-1 items-center gap-3 rounded-full bg-capy-danger/10 px-4 py-3">
            <button
              onClick={() => stopRecording(true)}
              className="text-capy-danger"
              aria-label="Cancelar"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <span className="animate-rec-pulse h-3 w-3 rounded-full bg-capy-danger" />
            <span className="font-mono text-sm text-capy-dark">{fmtDuration(recSeconds)}</span>
            <button
              onClick={() => stopRecording(false)}
              className="ml-auto rounded-full bg-capy-green p-2.5 text-white"
              aria-label="Enviar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        ) : (
          <>
            {imagePreview && pendingImage ? (
              <div className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-capy-fur/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="preview"
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-capy-dark/60">
                    {pendingImage.name}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={handleSendImage}
                      disabled={uploadingImage}
                      className="rounded-full bg-capy-green px-3 py-1 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {uploadingImage ? "Enviando…" : "Enviar 📷"}
                    </button>
                    <button
                      onClick={() => {
                        setPendingImage(null);
                        setImagePreview(null);
                      }}
                      className="rounded-full bg-capy-fur/15 px-3 py-1 text-xs font-bold text-capy-dark"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  emitTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder="Mensagem"
                className="capy-input max-h-32 flex-1 resize-none py-3"
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full bg-capy-fur/15 p-3.5 text-capy-dark transition hover:bg-capy-fur/25"
              aria-label="Enviar imagem"
              title="Enviar imagem"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            </button>
            {text.trim() === "" ? (
              <button
                onClick={startRecording}
                className="rounded-full bg-capy-green p-3.5 text-white shadow hover:bg-capy-deep"
                aria-label="Gravar áudio"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={sending}
                className="rounded-full bg-capy-green p-3.5 text-white shadow hover:bg-capy-deep disabled:opacity-60"
                aria-label="Enviar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              </button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}

function Ticks({ read }: { read: boolean }) {
  return read ? (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#4CA66E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 7 3.5 9.5 8 4"/><path d="M6.5 9.5 8 11 15 3"/>
    </svg>
  ) : (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.55 }}>
      <path d="M2 6.5 4.5 9 9.5 3"/>
    </svg>
  );
}

/** Busca o texto da mensagem respondida (para o quote da bolha). */
function replyQuoteOf(m: Message, all: Message[]): string | null {
  if (!m.reply_to_id) return null;
  const target = all.find((x) => x.id === m.reply_to_id);
  if (!target || target.deleted) return "mensagem apagada";
  return target.kind === "audio" ? "🎤 áudio" : target.body ?? "";
}

function MessageBubble({
  m,
  prev,
  mine,
  read,
  replyBody,
  senderName,
  onReply,
  onEdit,
  onDelete,
}: {
  m: Message;
  prev?: Message;
  mine: boolean;
  read: boolean;
  replyBody: string | null;
  senderName: string | null;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dayChange =
    !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();

  if (m.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-capy-dark/10 px-3 py-1 text-[11px] text-capy-dark/60">
          {m.body}
        </span>
      </div>
    );
  }

  return (
    <>
      {dayChange && (
        <div className="my-3 flex justify-center">
          <span className="rounded-lg bg-capy-dark/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-capy-dark/60">
            {fmtDayDivider(m.created_at)}
          </span>
        </div>
      )}
      <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className={`relative max-w-[82%] md:max-w-md ${mine ? "order-1" : ""}`}>
          <div
            className={`relative rounded-2xl px-3 py-2 shadow-sm ${
              mine
                ? "rounded-br-md bg-capy-bubble"
                : "rounded-bl-md bg-white"
            }`}
          >
            {senderName && !mine && (
              <p className="mb-0.5 text-xs font-bold text-capy-accent">{senderName}</p>
            )}

            {replyBody && (
              <div className="mb-1 rounded-md border-l-4 border-capy-green bg-capy-green/10 px-2 py-1 text-xs text-capy-dark/75">
                {replyBody.slice(0, 120)}
              </div>
            )}

            {m.deleted ? (
              <p className="text-sm italic text-capy-dark/50">
                🚫 Esta mensagem foi apagada
              </p>
            ) : m.kind === "image" && m.image_url ? (
              <ImageBubble path={m.image_url} />
            ) : m.kind === "audio" && m.audio_url ? (
              <AudioBubble path={m.audio_url} duration={m.audio_duration} />
            ) : (
              <p className="whitespace-pre-wrap break-words text-[15px] text-capy-dark">
                {m.body}
              </p>
            )}

            {/* hora + editada + ticks */}
            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-capy-dark/50">
              {m.edited_at && !m.deleted && <span className="italic">editada</span>}
              <span>{fmtTime(m.created_at)}</span>
              {mine && !m.deleted && <Ticks read={read} />}
            </div>
          </div>

          {/* menu contextual */}
          {!m.deleted && (
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className={`absolute top-1 ${mine ? "-left-7" : "-right-7"} hidden rounded p-1 text-capy-dark/30 hover:text-capy-dark group-hover:block`}
              aria-label="Ações"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
          )}
          {menuOpen && (
            <div className="absolute z-10 mt-1 w-40 overflow-hidden rounded-xl bg-white text-sm shadow-xl ring-1 ring-capy-fur/15">
              <button
                onClick={() => {
                  onReply();
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-capy-bubble/50"
              >
                ↩️ Responder
              </button>
              {mine && m.kind === "text" && !m.deleted && (
                <button
                  onClick={() => {
                    onEdit();
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-capy-bubble/50"
                >
                  ✏️ Editar
                </button>
              )}
              {mine && (
                <button
                  onClick={() => {
                    onDelete();
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-capy-danger hover:bg-capy-danger/10"
                >
                  🚫 Apagar p/ todos
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ImageBubble({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await getSignedImageUrl(path);
      if (alive) setUrl(u);
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (!url) {
    return (
      <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-capy-fur/10">
        <span className="h-3 w-3 animate-pulse rounded-full bg-capy-green" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="imagem"
      loading="lazy"
      className="max-h-72 w-auto max-w-full rounded-lg object-contain"
    />
  );
}

function AudioBubble({
  path,
  duration,
}: {
  path: string;
  duration: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await getSignedAudioUrl(path);
      if (!alive) return;
      setUrl(u);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (loading || !url) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-capy-dark/50">
        <span className="h-2 w-2 animate-pulse rounded-full bg-capy-green" /> carregando áudio…
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      <audio controls preload="metadata" src={url} className="h-10 max-w-[230px] md:max-w-xs" />
      <span className="ml-1 text-[11px] font-medium text-capy-dark/60">
        {fmtDuration(duration)}
      </span>
    </div>
  );
}
