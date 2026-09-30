"use client";

/**
 * Fila offline (outbox) — mensagens de texto enviadas sem internet
 * ficam salvas no localStorage e saem sozinhas quando a conexão volta.
 * Escopo: só texto (áudio/foto dependem de upload maior — mostram erro).
 */

export type PendingMessage = {
  tempId: string;
  conversationId: string;
  body: string;
  replyTo: string | null;
  queuedAt: string; // ISO
};

const KEY = "capyzap-outbox";

function readAll(): PendingMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as PendingMessage[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: PendingMessage[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export function getPending(conversationId: string): PendingMessage[] {
  return readAll()
    .filter((p) => p.conversationId === conversationId)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export function enqueuePending(
  conversationId: string,
  body: string,
  replyTo: string | null
): PendingMessage {
  const msg: PendingMessage = {
    tempId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    body,
    replyTo,
    queuedAt: new Date().toISOString(),
  };
  writeAll([...readAll(), msg]);
  return msg;
}

export function removePending(tempId: string) {
  writeAll(readAll().filter((p) => p.tempId !== tempId));
}

/** Envia tudo que estiver na fila. Devolve quantas saíram. */
export async function flushOutbox(
  send: (p: PendingMessage) => Promise<void>
): Promise<number> {
  let sent = 0;
  for (const p of readAll()) {
    try {
      await send(p);
      removePending(p.tempId);
      sent += 1;
    } catch {
      break; // ainda sem internet — tenta de novo no próximo ciclo
    }
  }
  return sent;
}
