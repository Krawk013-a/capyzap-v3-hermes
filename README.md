# CapyZap 🦫🌿

Mensageria web estilo WhatsApp — **sem número de telefone** (só e-mail), com tempo real, áudio, grupos, PWA e identidade capivara. Feito pra ser leve, seguro e funcionar na rede da escola.

> Feito por Enzo da Silva Santos — Next.js 14 + Supabase + Tailwind CSS.

---

## ✨ Funcionalidades

| Recurso | Status |
|---|---|
| Cadastro/login por e-mail (sem telefone) | ✅ |
| Chat 1:1 em tempo real (Supabase Realtime) | ✅ |
| Grupos (criar, nomear, adicionar pessoas) | ✅ |
| Mensagens de áudio (gravar / enviar / ouvir) | ✅ |
| ✓ Enviado / ✓✓ Lido (via `last_read_at`) | ✅ |
| Responder mensagem (quote) | ✅ |
| Apagar mensagem para todos | ✅ |
| Busca de pessoas por nome ou @handle | ✅ |
| Toast de nova mensagem dentro do app | ✅ |
| PWA instalável (ícone na tela inicial) | ✅ |
| Perfil com foto (upload p/ bucket) | ✅ |
| Segurança: RLS completa no Postgres | ✅ |
| Transcrição de áudio com IA | 🔜 roadmap (deixado de fora do MVP a pedido) |

## 🧱 Stack

- **Frontend:** Next.js 14 (App Router, TypeScript) + Tailwind CSS
- **Backend/Banco:** Supabase (Postgres + RLS, Auth, Realtime, Storage)
- **PWA:** manifest.json + service worker próprios (sem dependências)
- **Ícones:** capivara gerada por script (`scripts/gen_icons.py`)

## 🚀 Como rodar (10 minutos)

### 1. Criar o projeto no Supabase (5 min)

1. Acesse [supabase.com](https://supabase.com) → **New project** (plano free serve)
2. Escolha nome (ex.: `capyzap`) e uma senha forte pro banco
3. Aguarde o provisionamento (~2 min)

### 2. Rodar o schema SQL (2 min)

1. No painel do Supabase: **SQL Editor → New query**
2. Cole **todo** o conteúdo de [`supabase/schema.sql`](supabase/schema.sql)
3. **Run** — cria tabelas, funções RPC, RLS, publication realtime e buckets

> ⚠️ Se o trecho de Storage falhar em projetos novos (política de acesso),
> crie manualmente em **Storage → New bucket**: `avatars` (público) e
> `audio` (**privado**). As policies de storage estão no fim do schema.sql.

### 3. Configurar Auth (1 min)

- **Authentication → Providers → Email**: já vem habilitado
- Para testar rápido, desligue **Confirm email** (Authentication → Settings)
- Ative **Enable email sign-ups** (se pedir)

### 4. Rodar o app (2 min)

```bash
npm install
cp .env.local.example .env.local   # preencha os 2 valores abaixo
```

Edite `.env.local` com os dados de **Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Depois:

```bash
npm run dev     # http://localhost:3000
```

Produção:

```bash
npm run build && npm start
```

Deploy grátis: [Vercel](https://vercel.com) → importe o repo, adicione as mesmas
2 variáveis de ambiente → deploy.

## 📱 Instalar como app (PWA)

- **Android/Chrome:** menu ⋮ → "Instalar app" / "Adicionar à tela inicial"
- **iPhone (Safari, iOS 16.4+):** botão Compartilhar → "Adicionar à Tela de Início"

## 🔐 Segurança (o que a RLS garante)

- Mensagens só são lidas por **participantes da conversa**
- Áudios ficam em bucket **privado** — a URL é assinada (expira em 1h)
- Ninguém sobe áudio em conversa alheia (path `audio/<convo_id>/...` validado por policy)
- Cada usuário só edita o próprio perfil e a própria linha em `participants`
- Perfis são legíveis (busca social), mas só o dono edita o seu

Testado localmente com cenário de 3 usuários (Alice/Bob/Carol) simulando
ataques de leitura e escrita cruzada — todos bloqueados (ver
`supabase/local_test_rls.sql`).

## 🗂️ Estrutura

```
capyzap/
├── src/
│   ├── app/
│   │   ├── login/          # entrar
│   │   ├── signup/         # cadastrar (nome, sobrenome, e-mail, senha)
│   │   ├── chat/           # lista de conversas + busca + novo grupo
│   │   │   └── [id]/       # conversa ativa (mensagens, áudio, ticks)
│   │   ├── profile/        # perfil + foto
│   │   └── layout.tsx      # PWA register, tema
│   ├── components/         # Avatar, Toast, PwaRegister
│   ├── lib/                # clientes supabase, data, formatos
│   └── middleware.ts       # sessão + guarda de rotas
├── supabase/
│   ├── schema.sql          # ⭐ cole isto no SQL Editor
│   ├── local_test_stubs.sql # (uso interno de teste local)
│   └── local_test_rls.sql  # (uso interno de teste local)
├── public/
│   ├── manifest.json       # PWA
│   ├── sw.js               # service worker
│   └── icons/              # capivara 🦫
└── scripts/gen_icons.py    # gera os PNGs/SVG
```

## 🛣️ Roadmap

- [ ] Transcrição de áudio (Gemini API) — estrutura já preparada
- [ ] "digitando…" (Realtime Broadcast)
- [ ] Notificações push (Web Push)
- [ ] Envio de imagens
- [ ] Fila offline (mensagem salva local e enviada ao reconectar)

## 📄 Licença

MIT — usa à vontade. 🌿
