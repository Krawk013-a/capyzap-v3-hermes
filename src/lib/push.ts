"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Converte a chave pública VAPID (base64url) em Uint8Array —
 * formato exigido por PushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Registra o device para push e salva a inscrição no Supabase.
 * Requer: SW instalado, permissão concedida e usuário logado.
 */
export async function registerPush(): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }

  // permissão
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission; // "denied" | "default"

  // service worker pronto
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // chave pública (var de ambiente — vercel/replaceme)
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return "no-vapid-key";

  // inscreve (ou reutiliza inscrição existente)
  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
  } catch {
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }

  // salva no Supabase (upsert por endpoint único)
  const supabase = getSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "no-user";

  const payload = {
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: (sub.getKey("p256dh") as Buffer | null)?.toString("base64") ?? null,
    auth: (sub.getKey("auth") as Buffer | null)?.toString("base64") ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(payload, { onConflict: "endpoint" });

  return error ? "save-failed" : "ok";
}

/** Estado atual da permissão de notificação. */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}
