-- =========================================================
-- AgendaPro — schema do banco (rodar inteiro no SQL Editor do Supabase)
-- Multi-tenant: cada "business" (negócio/assinante) é isolado por RLS.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- TABELAS ----------

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text unique not null,
  name text not null default 'Meu Negócio',
  segment text not null default 'salao',
  logo_url text,
  whatsapp text,
  created_at timestamptz default now()
);

create table if not exists professionals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  spec text,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  color text not null default '#7b61ff',
  created_at timestamptz default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  duration int not null default 60,
  created_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  client_name text not null,
  client_phone text not null,
  date date not null,
  time time not null,
  duration int not null,
  price numeric(10,2) not null default 0,
  status text not null default 'pendente' check (status in ('pendente','pago','cancelado')),
  created_at timestamptz default now()
);

create index if not exists idx_prof_business on professionals(business_id);
create index if not exists idx_serv_business on services(business_id);
create index if not exists idx_appt_business on appointments(business_id);
create index if not exists idx_appt_prof_date on appointments(professional_id, date);

-- ---------- ROW LEVEL SECURITY ----------

alter table businesses enable row level security;
alter table professionals enable row level security;
alter table services enable row level security;
alter table appointments enable row level security;

-- BUSINESSES
-- dono gerencia o próprio negócio
create policy "owner manages business" on businesses
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- qualquer pessoa pode ler os dados públicos do negócio (nome, logo, cor) para a página de agendamento
create policy "public can read business" on businesses
  for select using (true);

-- PROFESSIONALS
create policy "owner manages professionals" on professionals
  for all using (exists (select 1 from businesses b where b.id = professionals.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = professionals.business_id and b.owner_id = auth.uid()));
create policy "public can read professionals" on professionals
  for select using (true);

-- SERVICES
create policy "owner manages services" on services
  for all using (exists (select 1 from businesses b where b.id = services.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = services.business_id and b.owner_id = auth.uid()));
create policy "public can read services" on services
  for select using (true);

-- APPOINTMENTS
-- dono vê e gerencia todos os agendamentos do seu negócio (inclui nome/telefone do cliente)
create policy "owner manages appointments" on appointments
  for all using (exists (select 1 from businesses b where b.id = appointments.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = appointments.business_id and b.owner_id = auth.uid()));
-- qualquer pessoa pode CRIAR um agendamento (fluxo de auto-agendamento público), sempre como "pendente"
create policy "public can create appointment" on appointments
  for insert with check (status = 'pendente');
-- OBS: não existe policy de SELECT pública em appointments — visitantes não conseguem ler
-- nome/telefone de outros clientes. Para calcular horários livres, use a função abaixo.

-- ---------- FUNÇÃO PÚBLICA PARA HORÁRIOS OCUPADOS (sem expor dados do cliente) ----------

create or replace function public.get_busy_slots(p_business_id uuid, p_professional_id uuid, p_date date)
returns table(slot_time text, slot_duration int)
language sql
security definer
set search_path = public
as $$
  select time::text, duration
  from appointments
  where business_id = p_business_id
    and professional_id = p_professional_id
    and date = p_date
    and status <> 'cancelado';
$$;

grant execute on function public.get_busy_slots(uuid, uuid, date) to anon, authenticated;

-- ---------- STORAGE (rode manualmente na tela Storage do Supabase) ----------
-- Crie um bucket público chamado "logos" (Storage → New bucket → Public bucket = ON)
-- Isso é usado para guardar o logotipo de cada negócio.
