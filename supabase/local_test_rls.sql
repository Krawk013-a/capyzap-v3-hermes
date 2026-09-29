-- ============================================================
-- Testes de RLS do CapyZap — roda APÓS schema.sql + stubs.
-- Cenário: 3 usuários (Alice, Bob, Carol). Esperado:
--  - Alice lê só as conversas/participa; Bob idem (DMs separadas)
--  - Carol NÃO lê a DM Alice-Bob (nem mensagens, nem storage)
--  - get_or_create_dm devolve a MESMA conversa nas 2 chamadas
--  - create_group funciona; mensagens chegam aos membros
--  - participantes só atualizam a própria linha (last_read_at)
-- ============================================================

-- limpar estado anterior
delete from auth.users;
truncate public.profiles, public.conversations, public.participants, public.messages cascade;

-- ---------- seed: 3 usuários via trigger (como no signup) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.com',
   '{"first_name":"Alice","last_name":"Silva"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.com',
   '{"first_name":"Bob","last_name":"Souza"}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.com',
   '{"first_name":"Carol","last_name":"Lima"}');

do $$ begin
  if (select count(*) from public.profiles) <> 3 then
    raise exception 'FAIL: trigger não criou 3 profiles (got %)', (select count(*) from public.profiles);
  end if;
  if (select count(*) from public.profiles where handle is null or handle = '') <> 0 then
    raise exception 'FAIL: profiles sem handle';
  end if;
end $$;

-- ---------- como Alice (role authenticated) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- Alice cria DM com Bob via RPC
do $$ begin
  if (select public.get_or_create_dm('22222222-2222-2222-2222-222222222222'))::text is null then
    raise exception 'FAIL: get_or_create_dm retornou null';
  end if;
end $$;

-- segunda chamada deve devolver a mesma conversa (idempotente)
do $$
declare a uuid; b uuid;
begin
  a := public.get_or_create_dm('22222222-2222-2222-2222-222222222222');
  b := public.get_or_create_dm('22222222-2222-2222-2222-222222222222');
  if a is distinct from b then
    raise exception 'FAIL: get_or_create_dm não é idempotente (%) vs (%)', a, b;
  end if;
end $$;

-- Alice envia mensagem na DM
do $$
declare convo uuid := public.get_or_create_dm('22222222-2222-2222-2222-222222222222');
begin
  insert into public.messages (conversation_id, sender_id, body)
  values (convo, '11111111-1111-1111-1111-111111111111', 'oi bob!');
  if not exists (select 1 from public.messages where body = 'oi bob!') then
    raise exception 'FAIL: mensagem da Alice não inseriu';
  end if;
end $$;

-- Alice cria grupo com Bob e Carol
do $$
declare g uuid;
begin
  g := public.create_group('Turma', array['22222222-2222-2222-2222-222222222222'::uuid, '33333333-3333-3333-3333-333333333333'::uuid]);
  if g is null then
    raise exception 'FAIL: create_group retornou null';
  end if;
  if (select count(*) from public.participants where conversation_id = g) <> 3 then
    raise exception 'FAIL: grupo deveria ter 3 participantes';
  end if;
end $$;

reset role;

-- superuser captura o ID da DM Alice-Bob para o teste de áudio forjado
do $$
declare dm uuid;
begin
  select c.id into dm from public.conversations c where c.is_group = false limit 1;
  perform set_config('capy.dm_id', dm::text, false);
end $$;

-- ---------- como Carol: NÃO pode ler a DM Alice-Bob ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

do $$ begin
  if exists (
    select 1 from public.messages m
    where m.body = 'oi bob!'
  ) then
    raise exception 'FAIL: Carol leu mensagem da DM Alice-Bob!';
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from public.participants p
    join public.conversations c on c.id = p.conversation_id
    where c.is_group = false
  ) then
    raise exception 'FAIL: Carol viu participantes da DM alheia';
  end if;
end $$;

-- Carol não consegue descobrir o ID da DM alheia (RLS esconde)
do $$
declare dm uuid;
begin
  select id into dm from public.conversations c where c.is_group = false;
  if dm is not null then
    raise exception 'FAIL: Carol descobriu id de conversa alheia (%)', dm;
  end if;
end $$;

-- Carol VÊ o grupo (é membro) e envia mensagem lá
do $$
declare g uuid;
begin
  select id into g from public.conversations where name = 'Turma';
  insert into public.messages (conversation_id, sender_id, body)
  values (g, '33333333-3333-3333-3333-333333333333', 'oi gente!');
  if not exists (select 1 from public.messages where body = 'oi gente!') then
    raise exception 'FAIL: mensagem da Carol no grupo não inseriu';
  end if;
end $$;

-- Carol tenta atualizar last_read_at do BOB → deve falhar silenciosamente (0 linhas)
do $$
declare n int;
begin
  update public.participants
     set last_read_at = now()
   where conversation_id = (select id from public.conversations where name = 'Turma')
     and user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL: Carol atualizou last_read_at do Bob!';
  end if;
end $$;

-- Carol tenta INSERIR áudio com o ID da DM alheia (forjado) → policy deve barrar
do $$
declare dm text := current_setting('capy.dm_id');
begin
  insert into storage.objects (bucket_id, name)
  values ('audio', dm || '/spy.webm');
  raise exception 'FAIL: Carol inseriu áudio em conversa alheia!';
exception
  when insufficient_privilege then null;          -- barrado pela policy ✓
  when check_violation then null;                 -- barrado pela policy ✓
end $$;

reset role;

-- ---------- como Bob: lê a DM e marca como lida ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

do $$ begin
  if not exists (select 1 from public.messages where body = 'oi bob!') then
    raise exception 'FAIL: Bob não conseguiu ler a mensagem da Alice';
  end if;
end $$;

-- Bob marca a própria last_read_at (permitido)
do $$
declare n int;
begin
  update public.participants
     set last_read_at = now()
   where conversation_id = (select id from public.conversations where is_group = false limit 1)
     and user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: Bob não atualizou a própria last_read_at (%)', n;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------- resultado ----------
do $$ begin
  raise notice 'ALL RLS TESTS PASSED ✅';
end $$;
