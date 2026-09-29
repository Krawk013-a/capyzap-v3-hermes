-- ============================================================
-- CapyZap — Schema completo (Supabase / Postgres)
-- Cole isto inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================

-- Extensões --------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================
-- 1) TABELAS
-- ============================================================

-- Perfis: 1 linha por usuário (criada via trigger no signup)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  handle text unique,                      -- ex.: @maria (único, opcional)
  avatar_url text,
  last_seen_at timestamptz not null default now(), -- "visto por último"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conversas: DM (is_group=false) ou grupo
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text,                              -- nome do grupo (null em DMs)
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Participantes
create table if not exists public.participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Mensagens
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','audio','image','system')),
  image_url text,
  body text,                              -- texto ou transcrição futura
  audio_url text,
  audio_duration numeric,                  -- segundos
  reply_to_id uuid references public.messages(id) on delete set null,
  deleted boolean not null default false, -- "apagar para todos"
  edited_at timestamptz,               -- preenchido quando editada
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at desc);
create index if not exists idx_participants_user
  on public.participants (user_id);
create index if not exists idx_messages_sender
  on public.messages (sender_id);

-- ============================================================
-- 2) FUNÇÕES AUXILIARES
-- ============================================================

-- O usuário participa da conversa?
create or replace function public.is_participant(convo_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.participants p
    where p.conversation_id = convo_id and p.user_id = uid
  );
$$;

-- Retorna o "outro" usuário da DM (para título e avatar da conversa)
create or replace function public.dm_other_user(convo_id uuid, uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.participants p
  where p.conversation_id = convo_id
    and p.user_id <> uid
  limit 1;
$$;

-- Cria a DM entre dois usuários (ou devolve a existente) — chamada
-- via RPC pelo frontend quando alguém toca numa pessoa da busca.
create or replace function public.get_or_create_dm(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_convo uuid;
begin
  if me is null or other_user is null or me = other_user then
    raise exception 'invalid_request';
  end if;

  select c.id into existing_convo
  from public.conversations c
  join public.participants a on a.conversation_id = c.id and a.user_id = me
  join public.participants b on b.conversation_id = c.id and b.user_id = other_user
  where c.is_group = false
    and (select count(*) from public.participants p where p.conversation_id = c.id) = 2
  limit 1;

  if existing_convo is not null then
    return existing_convo;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, me)
  returning id into existing_convo;

  insert into public.participants (conversation_id, user_id)
  values (existing_convo, me), (existing_convo, other_user);

  return existing_convo;
end;
$$;

-- Cria um grupo com o criador + participantes
create or replace function public.create_group(p_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_convo uuid;
  mid uuid;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_group_name';
  end if;

  insert into public.conversations (is_group, name, created_by)
  values (true, trim(p_name), me)
  returning id into new_convo;

  insert into public.participants (conversation_id, user_id)
  values (new_convo, me);

  foreach mid in array member_ids
  loop
    if mid <> me then
      insert into public.participants (conversation_id, user_id)
      values (new_convo, mid)
      on conflict do nothing;
    end if;
  end loop;

  insert into public.messages (conversation_id, sender_id, kind, body)
  values (new_convo, me, 'system', 'Grupo criado');

  return new_convo;
end;
$$;

-- ============================================================
-- 3) TRIGGER: criar profile automaticamente no signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
begin
  base_handle := regexp_replace(
    lower(coalesce(new.raw_user_meta_data->>'first_name', 'capy')),
    '[^a-z0-9]', '', 'g'
  );
  if base_handle = '' or base_handle is null then
    base_handle := 'capy';
  end if;

  insert into public.profiles (id, email, first_name, last_name, handle)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    base_handle || (floor(random() * 9000) + 1000)::int::text
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 4) ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.participants  enable row level security;
alter table public.messages      enable row level security;

-- PROFILES
create policy "profiles_select" on public.profiles
  for select using (true);   -- busca de usuários precisa listar perfis

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

-- CONVERSATIONS
create policy "conversations_select_member" on public.conversations
  for select using (public.is_participant(id, auth.uid()));

-- (inserção de conversas acontece via RPC get_or_create_dm/create_group)
create policy "conversations_insert_own" on public.conversations
  for insert with check (created_by = auth.uid());

create policy "conversations_update_member" on public.conversations
  for update using (public.is_participant(id, auth.uid()));

-- PARTICIPANTS
create policy "participants_select_member" on public.participants
  for select using (
    user_id = auth.uid()
    or public.is_participant(conversation_id, auth.uid())
  );

-- pode adicionar-se a si, ou membros podem adicionar outros
create policy "participants_insert" on public.participants
  for insert with check (
    user_id = auth.uid()
    or public.is_participant(conversation_id, auth.uid())
  );

-- cada usuário atualiza apenas a própria linha (ex.: last_read_at)
create policy "participants_update_own" on public.participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- MESSAGES
create policy "messages_select_member" on public.messages
  for select using (public.is_participant(conversation_id, auth.uid()));

create policy "messages_insert_member" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_participant(conversation_id, auth.uid())
  );

create policy "messages_update_sender" on public.messages
  for update using (sender_id = auth.uid());

create policy "messages_delete_sender" on public.messages
  for delete using (sender_id = auth.uid());

-- ============================================================
-- 5) REALTIME
-- ============================================================
-- IMPORTANTE: com RLS ativo, o Supabase exige REPLICA IDENTITY FULL
-- nas tabelas ou os eventos postgres_changes NÃO são entregues.
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
-- 6) STORAGE (buckets) — em projetos novos o SQL Editor
--    também aceita os comandos de storage; se falhar no seu
--    projeto, crie os buckets pelo Dashboard (veja README).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('images', 'images', false)
on conflict (id) do nothing;

-- Avatares: públicos p/ leitura, upload só do próprio dono
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- troca de foto de perfil (upsert no mesmo path)
create policy "avatars_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Áudio: privado; leitura apenas de participantes da conversa
-- (decidida pelo padrão de path: audio/<conversation_id>/<file>)
create policy "audio_read_participant" on storage.objects
  for select using (
    bucket_id = 'audio'
    and public.is_participant(
      ((storage.foldername(name))[1])::uuid, auth.uid()
    )
  );

create policy "audio_upload_participant" on storage.objects
  for insert with check (
    bucket_id = 'audio'
    and public.is_participant(
      ((storage.foldername(name))[1])::uuid, auth.uid()
    )
  );

-- Imagens: privadas; leitura/upload apenas de participantes da conversa
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

-- ============================================================
-- 7) NOTIFICAÇÕES PUSH — inscrições de dispositivos
-- ============================================================
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

create policy "push_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());

create policy "push_insert_own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

create policy "push_update_own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "push_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ============================================================
-- PRONTO! ✅
-- No Dashboard: Authentication -> Providers -> Email precisa
-- estar habilitado (já vem por padrão). Confirmar e-mails é
-- opcional (para testar rápido, deixe desligado).
-- ============================================================
