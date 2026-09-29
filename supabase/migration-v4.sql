-- ============================================================
-- CapyZap — MIGRAÇÃO v4 (idempotente: rode quantas vezes quiser)
-- Adiciona: sistema de sugestões com votação sim/não
-- Cole no SQL Editor do Supabase e rode UMA vez (repetir é seguro).
-- (Notas de atualização são arquivo estático — não precisa SQL.)
-- ============================================================

-- 1) Sugestões
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  status text not null default 'open' check (status in ('open','planned','done','rejected')),
  created_at timestamptz not null default now()
);

-- 2) Votos (1 por usuário por sugestão): true = sim, false = não
create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote boolean not null,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

alter table public.suggestions      enable row level security;
alter table public.suggestion_votes enable row level security;

-- policies idempotentes
drop policy if exists "suggestions_select" on public.suggestions;
drop policy if exists "suggestions_insert_own" on public.suggestions;
drop policy if exists "suggestions_delete_own" on public.suggestions;
drop policy if exists "votes_select" on public.suggestion_votes;
drop policy if exists "votes_insert_own" on public.suggestion_votes;
drop policy if exists "votes_update_own" on public.suggestion_votes;
drop policy if exists "votes_delete_own" on public.suggestion_votes;

create policy "suggestions_select" on public.suggestions
  for select using (true);
create policy "suggestions_insert_own" on public.suggestions
  for insert with check (author_id = auth.uid());
create policy "suggestions_delete_own" on public.suggestions
  for delete using (author_id = auth.uid());

create policy "votes_select" on public.suggestion_votes
  for select using (true);
create policy "votes_insert_own" on public.suggestion_votes
  for insert with check (user_id = auth.uid());
create policy "votes_update_own" on public.suggestion_votes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "votes_delete_own" on public.suggestion_votes
  for delete using (user_id = auth.uid());

-- 3) Realtime (atualização ao vivo das sugestões e votos)
alter table public.suggestions      replica identity full;
alter table public.suggestion_votes replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'suggestions') then
    execute 'alter publication supabase_realtime add table public.suggestions';
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'suggestion_votes') then
    execute 'alter publication supabase_realtime add table public.suggestion_votes';
  end if;
end $$;

-- ============================================================
-- PRONTO ✅
-- ============================================================
