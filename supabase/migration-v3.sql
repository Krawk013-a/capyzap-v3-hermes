-- ============================================================
-- CapyZap — MIGRAÇÃO v3 (idempotente: rode quantas vezes quiser)
-- Adiciona: edição de mensagem (edited_at) e último online (last_seen_at)
-- Cole no SQL Editor do Supabase e rode UMA vez (repetir é seguro).
-- ============================================================

-- 1) Edição de mensagens: carimbo de "editada"
alter table public.messages
  add column if not exists edited_at timestamptz;

-- 2) Última vez online: heartbeat atualiza no perfil
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

update public.profiles
   set last_seen_at = now()
 where last_seen_at is null;

-- ============================================================
-- PRONTO ✅  (online/visto-por-último usa isto + Realtime Presence)
-- ============================================================
