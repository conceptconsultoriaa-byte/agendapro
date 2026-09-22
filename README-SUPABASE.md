# AgendaPro Cloud — versão com banco de dados real (Supabase) + GitHub Pages

Esta é a versão "de verdade": múltiplos assinantes, cada um com login próprio, dados isolados (multi-tenant), agenda geral + agenda por profissional, link público de agendamento por negócio, e link de agendamento que os clientes usam sem precisar de conta.

## O que você precisa abrir (só isso)

1. **Supabase** — https://supabase.com — plano gratuito. Banco de dados + login + storage do logotipo.
2. **GitHub** — você já tem. Vamos usar o GitHub Pages para publicar os arquivos.

Não precisa de Mercado Pago nem WhatsApp Business API nesta fase de validação — o pagamento continua sendo por link de WhatsApp (manual) e o lembrete abre o WhatsApp pronto para enviar, exatamente como no protótipo anterior.

---

## Passo 1 — Criar o projeto no Supabase

1. Acesse https://supabase.com → **Start your project** → crie a conta (pode entrar com GitHub).
2. **New project** → dê um nome (ex: `agendapro`) → escolha uma senha forte para o banco (guarde essa senha) → escolha a região mais próxima (ex: São Paulo/`sa-east-1` se disponível) → **Create new project**. Leva ~2 minutos para provisionar.

## Passo 2 — Rodar o schema do banco

1. No painel do projeto, abra **SQL Editor** (menu lateral) → **New query**.
2. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) desta pasta, copie **todo o conteúdo** e cole no editor.
3. Clique **Run**. Isso cria as 4 tabelas (`businesses`, `professionals`, `services`, `appointments`), ativa a segurança por linha (RLS) que isola os dados de cada assinante, e cria a função usada para calcular horários livres na página pública.

## Passo 3 — Criar o bucket do logotipo

1. Menu lateral → **Storage** → **New bucket**.
2. Nome: `logos` → ative **Public bucket** → **Create bucket**.

## Passo 4 — Pegar as chaves do projeto

1. Menu lateral → **Project Settings** (ícone de engrenagem) → **API**.
2. Copie **Project URL** e a chave **anon public**.
3. Abra o arquivo [`config.js`](config.js) desta pasta e cole os dois valores:

```js
window.SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
window.SUPABASE_ANON_KEY = "SUA-CHAVE-ANON-PUBLICA";
```

> A chave `anon` é pública por design — pode ficar exposta no navegador/GitHub sem problema, porque quem realmente protege os dados são as regras de RLS criadas no Passo 2.

## Passo 5 (opcional, recomendado para testar mais rápido) — desativar confirmação de e-mail

Por padrão o Supabase exige que o usuário confirme o e-mail antes de logar. Para testar mais rápido:
1. **Authentication** → **Providers** → **Email** → desative "Confirm email".
2. Você pode reativar isso depois, quando for para produção de verdade.

## Passo 6 — Publicar no GitHub Pages

1. Crie um repositório novo no GitHub (ex: `agendapro-cloud`) — pode ser público, não há segredo nos arquivos.
2. Suba todos os arquivos desta pasta (`index.html`, `login.html`, `agendar.html`, `app.js`, `login.js`, `agendar.js`, `style.css`, `config.js`, pasta `lib/`) para o repositório. **Não precisa subir a pasta `supabase/`** (é só o script SQL de referência, mas não tem problema deixá-la também).
3. No repositório → **Settings** → **Pages** → em "Build and deployment", Source: **Deploy from a branch** → Branch: `main` (pasta `/root`) → **Save**.
4. Em 1-2 minutos sua URL fica em `https://seuusuario.github.io/agendapro-cloud/`.

## Passo 7 — Testar o fluxo completo

1. Acesse `https://seuusuario.github.io/agendapro-cloud/login.html` → crie uma conta (e-mail/senha) → você cai direto no painel.
2. Em **Configurações**: defina o nome do negócio, segmento, WhatsApp e um "link" (slug) — por exemplo `salao-da-ana`.
3. Em **Profissionais**: cadastre 1-2 profissionais com horário de trabalho.
4. Copie o **link público de agendamento** que aparece em Configurações (algo como `.../agendar.html?empresa=salao-da-ana`) e abra em **outra aba anônima** (simulando um cliente) — faça um agendamento de teste.
5. Volte ao painel logado: veja o agendamento aparecer no Calendário Geral, no Calendário do Profissional e em Relatórios.

## Como isso vira "um app só, muda a marca"

Cada pessoa que assina cria a própria conta (Passo 7.1) — os dados dela ficam isolados dos outros assinantes automaticamente (RLS). Ela personaliza nome, logotipo, segmento e cor em Configurações, e recebe seu próprio link público de agendamento para divulgar aos clientes dela. Você não precisa duplicar código nem criar um site por cliente — é o mesmo app publicado uma vez.

## O que ainda é manual (e pode virar automático depois)

- **Pagamento**: hoje é um link de WhatsApp pedindo o pagamento; para gerar cobrança automática (Pix/cartão) é preciso Mercado Pago + um backend — veja `../agendapro-app/backend-example/server.js` do protótipo anterior, que já tem o código de referência pronto para isso.
- **Lembrete WhatsApp**: hoje abre a conversa pronta para clicar em enviar; para 100% automático (sem clique humano) é preciso a WhatsApp Business Cloud API da Meta.
- **Domínio próprio**: dá para apontar um domínio seu (ex: `agenda.seusite.com.br`) para o GitHub Pages nas configurações do repositório, se quiser um endereço mais profissional que `github.io`.

## Estrutura de arquivos

```
agendapro-cloud/
├── index.html         → painel do assinante (protegido por login)
├── app.js               → lógica do painel (fala com o Supabase)
├── login.html / login.js → cadastro/login
├── agendar.html / agendar.js → página pública de auto-agendamento (?empresa=slug)
├── style.css
├── config.js             → cole aqui a URL e a anon key do seu projeto Supabase
├── lib/supabaseClient.js
└── supabase/schema.sql   → script para rodar uma vez no SQL Editor do Supabase
```
