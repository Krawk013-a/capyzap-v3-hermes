-- ============================================================
-- CapyZap — MIGRAÇÃO v5 (idempotente: rode quantas vezes quiser)
-- Adiciona: admin (is_admin), chat com a CapyIA (bot + is_ai),
-- log de auditoria do modo suporte.
-- Cole no SQL Editor do Supabase e rode UMA vez.
-- ============================================================

-- 1) Admin: flag no perfil
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- >>> TORNE-SE ADMIN (troque o e-mail se o seu for outro) <<<
update public.profiles set is_admin = true
 where email = 'enzosilva0880@gmail.com';

-- 2) Conversas: marca o chat com a IA
alter table public.conversations
  add column if not exists is_ai boolean not null default false;

-- 3) Auditoria do modo suporte (quem entrou como quem, quando)
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;

-- só admin lê; escrita só via service role (Edge Function) — sem policy de insert
drop policy if exists "audit_admin_read" on public.admin_audit;
create policy "audit_admin_read" on public.admin_audit
  for select using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin)
  );

-- 4) Usuária bot "CapyIA" (UUID fixo — a Edge Function usa o mesmo)
insert into auth.users (id, email)
values ('a1b2c3d4-0000-4000-8000-00000000c0de', 'capyia@capyzap.local')
on conflict (id) do nothing;

insert into public.profiles (id, email, first_name, last_name, handle, avatar_url)
values ('a1b2c3d4-0000-4000-8000-00000000c0de', 'capyia@capyzap.local',
        'Capy', 'IA', 'capyia', '/icons/capy.svg')
on conflict (id) do nothing;

-- 5) RPC: abre (ou cria) o chat da pessoa com a CapyIA
create or replace function public.start_ai_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := 'a1b2c3d4-0000-4000-8000-00000000c0de';
  convo uuid;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select c.id into convo
  from public.conversations c
  join public.participants a on a.conversation_id = c.id and a.user_id = me
  join public.participants b on b.conversation_id = c.id and b.user_id = bot
  where c.is_ai = true
  limit 1;

  if convo is null then
    insert into public.conversations (is_group, is_ai, created_by)
    values (false, true, me)
    returning id into convo;

    insert into public.participants (conversation_id, user_id)
    values (convo, me), (convo, bot);
  end if;

  return convo;
end;
$$;

-- ============================================================
-- PRONTO ✅  Depois disso:
-- 1) supabase functions deploy notify-push admin-tools
-- 2) supabase secrets set NVIDIA_API_KEY=nvapi-... (chave do build.nvidia.com)
-- ============================================================
