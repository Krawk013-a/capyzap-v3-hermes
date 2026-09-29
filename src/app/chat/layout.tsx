"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ToastProvider } from "@/components/Toast";
import ChatSidebar from "@/components/ChatSidebar";
import { primeAudio } from "@/lib/sound";

/**
 * Layout de 2 colunas (WhatsApp Web style):
 * - Desktop: sidebar fixa à esquerda (380px) + painel da conversa à direita
 * - Mobile: na lista (/chat) a sidebar ocupa tudo; numa conversa ela some
 *   e a sala ocupa a tela cheia.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inRoom = pathname !== "/chat";

  // desbloqueia o áudio no primeiro toque/clique (política de autoplay)
  useEffect(() => {
    const once = () => {
      primeAudio();
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  return (
    <ToastProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-capy-sand">
        <div
          className={`${
            inRoom ? "hidden md:flex" : "flex"
          } h-full w-full md:w-[380px] md:shrink-0`}
        >
          <ChatSidebar />
        </div>
        <main
          className={`${
            inRoom ? "flex" : "hidden md:flex"
          } h-full min-w-0 flex-1`}
        >
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
