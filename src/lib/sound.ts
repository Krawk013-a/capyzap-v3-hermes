"use client";

/**
 * Plim de mensagem — com throttle (máx 1 a cada 3s) pra não virar
 * metralhadora em rajada de mensagens. Web Audio desbloqueia no
 * primeiro toque (política de autoplay dos navegadores).
 */

let ctx: AudioContext | null = null;
let lastPlim = 0;
const THROTTLE_MS = 3000;

export function primeAudio() {
  // chamar num clique/toque do usuário pra desbloquear o autoplay
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export async function playPlim() {
  try {
    primeAudio();
    if (!ctx) return;
    const now = Date.now();
    if (now - lastPlim < THROTTLE_MS) return; // throttle
    lastPlim = now;
    const res = await fetch("/sounds/plim.wav");
    const buf = await res.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    src.start();
  } catch {
    // som é enfeite — falha silenciosa
  }
}

/** Mostra notificação do sistema (via SW) — Windows/Android/iOS(PWA). */
export async function showLocalNotification(title: string, body: string, url: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // se o SW controlar notificações, usa ele (funciona com app em segundo plano)
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: "/icons/capy-192.png",
          badge: "/icons/capy-192.png",
          tag: url,
          data: { url },
        });
        return;
      }
    }
    // fallback: notificação via document (aba em primeiro plano)
    new Notification(title, { body, icon: "/icons/capy-192.png" });
  } catch {
    // silencioso
  }
}
