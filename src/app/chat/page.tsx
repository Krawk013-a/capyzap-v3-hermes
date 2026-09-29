/**
 * Painel direito do desktop quando nenhuma conversa está selecionada
 * (no mobile a lista ocupa a tela, então esta tela nem aparece).
 */
export default function ChatPage() {
  return (
    <section className="chat-bg flex h-full w-full items-center justify-center">
      <div className="max-w-sm px-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/capy.svg" alt="" className="mx-auto mb-4 h-28 w-28 opacity-90" />
        <p className="text-lg font-bold text-capy-dark">CapyZap Web 🌿</p>
        <p className="mt-1 text-sm text-capy-dark/60">
          Escolhe uma conversa à esquerda ou busca uma amiga pra começar.
        </p>
      </div>
    </section>
  );
}
