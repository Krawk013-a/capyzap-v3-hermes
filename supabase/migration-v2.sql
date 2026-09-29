-- ============================================================
-- CapyZap — MIGRAÇÃO v2 (idempotente: rode quantas vezes quiser)
-- Adiciona: imagens (coluna, bucket, policies) + push + realtime
-- Cole no SQL Editor do Supabase e rode UMA vez (ou de novo, é seguro).
-- ============================================================

-- ---------- 1) IMAGENS: coluna + constraint ----------
alter table public.messages
  add column if not exists image_url text;

alter table public.messages
  drop constraint if exists messages_kind_check;
alter table public.messages
  drop constraint if exists messages_kind_check1;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text','audio','image','system'));

-- ---------- 2) IMAGENS: bucket privado ----------
insert into storage.buckets (id, name, public)
values ('images', 'images', false)
on conflict (id) do nothing;

-- policies (idempotentes: remove antes de recriar)
drop policy if exists "images_read_participant" on storage.objects;
drop policy if exists "images_upload_participant" on storage.objects;

create policy "images_read_participant" on storage.objects
  for select using (
    bucket_id = 'images'
    and public.is_participant(
      ((storage.foldername(name))[1])::uuid, auth.uid()
    )
  );

create policy "images_upload_participant" on storage.objects
  for insert with check (
    bucket_id = 'images'
    and public.is_participant(
      ((storage.foldername(name))[1])::uuid, auth.uid()
    )
  );

-- ---------- 3) PUSH: tabela de inscrições ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own" on public.push_subscriptions;
drop policy if exists "push_delete_own" on public.push_subscriptions;

create policy "push_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy "push_update_own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------- 4) REALTIME (exigência do Supabase p/ RLS) ----------
alter table public.messages      replica identity full;
alter table public.participants   replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and tablename = 'participants') then
    execute 'alter publication supabase_realtime add table public.participants';
  end if;
end $$;

-- ============================================================
-- PRONTO ✅  Rodou sem erro? Imagens, push e realtime ativos.
-- ============================================================
