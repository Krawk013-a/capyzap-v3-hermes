-- ============================================================
-- Stubs do Supabase para teste LOCAL (NÃO rodar no Supabase!)
-- Simula: auth.users, auth.uid(), storage.buckets/objects,
-- storage.foldername() e a publicação supabase_realtime.
-- ============================================================
create schema if not exists auth;
create schema if not exists storage;

-- auth.users (subconjunto suficiente)
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- auth.uid() lê do contexto da sessão (set via set_config)
create or replace function auth.uid()
returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- storage stubs
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

create or replace function storage.foldername(name text)
returns text[]
language sql immutable
as $$ select string_to_array(name, '/') $$;

-- No Supabase real, storage.objects JÁ vem com RLS habilitada
alter table storage.objects enable row level security;

-- papel "authenticated" (sem superuser, como no Supabase)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema auth, storage, public to authenticated;
grant all on all tables in schema auth, storage to authenticated;
grant all on all sequences in schema auth, storage to authenticated;

-- publicação realtime (o Supabase já tem; aqui criamos p/ o schema rodar)
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
