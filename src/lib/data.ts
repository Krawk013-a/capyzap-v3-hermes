"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { ChatListItem, Message, Profile } from "@/types";

const sb = () => getSupabaseBrowserClient();

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return null;
  const { data } = await sb()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return data as Profile | null;
}

export async function searchUsers(query: string): Promise<Profile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data: { user } } = await sb().auth.getUser();
  const { data } = await sb()
    .from("profiles")
    .select("*")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,handle.ilike.%${q}%`)
    .limit(20);
  return (data ?? []).filter((p: Profile) => p.id !== user?.id) as Profile[];
}

/** Carrega a lista de conversas com última mensagem, não-lidas e perfis. */
export async function fetchChatList(): Promise<ChatListItem[]> {
  const supabase = sb();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // 1) minhas participações + conversas
  const { data: myParts } = await supabase
    .from("participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);
  if (!myParts || myParts.length === 0) return [];

  const ids = myParts.map((p) => p.conversation_id);
  const { data: convos } = await supabase
    .from("conversations")
    .select("*")
    .in("id", ids);
  if (!convos) return [];

  // 2) todos os participantes dessas conversas (perfis)
  const { data: allParts } = await supabase
    .from("participants")
    .select("conversation_id, user_id, profiles(*)")
    .in("conversation_id", ids);
  const profileOf = new Map<string, Profile>();
  const membersOf = new Map<string, Profile[]>();
  for (const p of allParts ?? []) {
    const prof = p.profiles as unknown as Profile;
    profileOf.set(p.user_id, prof);
    const arr = membersOf.get(p.conversation_id) ?? [];
    arr.push(prof);
    membersOf.set(p.conversation_id, arr);
  }

  // 3) última mensagem de cada conversa
  const { data: lastMsgs } = await supabase
    .from("messages")
    .select("*")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(500);
  const lastOf = new Map<string, Message>();
  for (const m of lastMsgs ?? []) {
    if (!lastOf.has(m.conversation_id)) lastOf.set(m.conversation_id, m as Message);
  }

  const items: ChatListItem[] = convos.map((c) => {
    const last = lastOf.get(c.id) ?? null;
    const mine = myParts.find((p) => p.conversation_id === c.id);
    const unread = (lastMsgs ?? []).filter(
      (m) =>
        m.conversation_id === c.id &&
        m.sender_id !== user.id &&
        m.kind !== "system" &&
        new Date(m.created_at) > new Date(mine?.last_read_at ?? 0)
    ).length;
    const others = (membersOf.get(c.id) ?? []).filter(
      (p) => p.id !== user.id
    );
    // conversa com a IA: garante identidade da CapyIA mesmo sem profile cache
    if (c.is_ai && others[0]) {
      others[0] = {
        ...others[0],
        first_name: others[0]?.first_name || "Capy",
        last_name: others[0]?.last_name || "IA",
        avatar_url: others[0]?.avatar_url || "/icons/capy.svg",
      };
    }
    return {
      conversation: c,
      lastMessage: last,
      unread,
      otherUser: c.is_group ? null : others[0] ?? null,
      participants: membersOf.get(c.id) ?? [],
    };
  });

  // ordena: com mensagem primeiro (mais recente primeiro), sem mensagem por criação
  items.sort((a, b) => {
    const ta = a.lastMessage ? +new Date(a.lastMessage.created_at) : +new Date(a.conversation.created_at);
    const tb = b.lastMessage ? +new Date(b.lastMessage.created_at) : +new Date(b.conversation.created_at);
    return tb - ta;
  });
  return items;
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data } = await sb()
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);
  return (data ?? []) as Message[];
}

export async function markConversationRead(conversationId: string) {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return;
  await sb()
    .from("participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
}

export async function sendTextMessage(
  conversationId: string,
  body: string,
  replyTo?: string | null
): Promise<Message> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error("not authenticated");
  const { data, error } = await sb()
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      kind: "text",
      body,
      reply_to_id: replyTo ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Message;
}

/** Envia a mensagem de imagem e devolve a linha criada. */
export async function sendImageMessage(
  conversationId: string,
  path: string
): Promise<Message> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error("not authenticated");
  const { data, error } = await sb()
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      kind: "image",
      image_url: path,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Message;
}

/** Edita o texto da própria mensagem (só o autor pode — RLS garante).
 * Se a coluna edited_at ainda não existir (migration-v3 não rodada),
 * cai pro plano B: edita sem o selo "editada" e sinaliza pro usuário. */
export async function editMessage(
  messageId: string,
  newBody: string
): Promise<{ ok: boolean; full: boolean }> {
  const { error } = await sb()
    .from("messages")
    .update({ body: newBody, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (!error) return { ok: true, full: true };

  // PGRST204 = coluna fora do schema cache (migration-v3 pendente)
  const missingCol =
    error.code === "PGRST204" ||
    /schema cache|edited_at|Could not find/i.test(error.message ?? "");
  if (missingCol) {
    const { error: err2 } = await sb()
      .from("messages")
      .update({ body: newBody })
      .eq("id", messageId);
    if (!err2) return { ok: true, full: false };
    throw err2;
  }
  throw error;
}

/** Heartbeat de "online" (atualiza last_seen_at do próprio perfil). */
export async function heartbeatSeen() {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return;
  await sb()
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", user.id);
}

/** URL assinada da imagem (bucket privado). */
export async function getSignedImageUrl(path: string): Promise<string> {
  const { data } = await sb()
    .storage
    .from("images")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

/** Envia a mensagem de áudio e devolve a linha criada (p/ UI otimista). */
export async function sendAudioMessage(
  conversationId: string,
  path: string,
  duration: number
): Promise<Message> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error("not authenticated");
  const { data, error } = await sb()
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      kind: "audio",
      audio_url: path,
      audio_duration: duration,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Message;
}

/** Gera URL assinada do áudio (bucket privado). Cache-friendly (3600s). */
export async function getSignedAudioUrl(path: string): Promise<string> {
  const { data } = await sb()
    .storage
    .from("audio")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? "";
}

export async function startDm(otherUserId: string): Promise<string | null> {
  const { data, error } = await sb().rpc("get_or_create_dm", { other_user: otherUserId });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function createGroupRpc(name: string, memberIds: string[]): Promise<string | null> {
  const { data, error } = await sb().rpc("create_group", { p_name: name, member_ids: memberIds });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function signOut() {
  await sb().auth.signOut();
}
