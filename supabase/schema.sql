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
-- Sem as políticas abaixo, o upload falha com "new row violates row-level security policy".

create policy "dono envia logo do proprio negocio" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and exists (select 1 from businesses b where b.owner_id = auth.uid() and b.id::text = (storage.foldername(name))[1])
  );

create policy "dono atualiza logo do proprio negocio" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and exists (select 1 from businesses b where b.owner_id = auth.uid() and b.id::text = (storage.foldername(name))[1])
  );

create policy "qualquer um pode ver os logos" on storage.objects
  for select using (bucket_id = 'logos');

-- ---------- MIGRAÇÃO: prazo do teste grátis (30 dias) ----------
alter table businesses add column if not exists trial_expires_at timestamptz;
update businesses set trial_expires_at = coalesce(trial_expires_at, created_at + interval '30 days');
alter table businesses alter column trial_expires_at set default (now() + interval '30 days');
alter table businesses alter column trial_expires_at set not null;

-- ---------- MIGRAÇÃO: conta do Mercado Pago de cada assinante (recebe direto do cliente final dele) ----------
alter table businesses add column if not exists mp_connected boolean not null default false;

create table if not exists mp_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  mp_user_id text,
  access_token text not null,
  refresh_token text,
  public_key text,
  connected_at timestamptz default now()
);
alter table mp_accounts enable row level security;
-- De propósito, nenhuma policy é criada aqui: só o backend (chave de serviço) acessa essa tabela.

-- ---------- MIGRAÇÃO: TrainPro (mesma tabela "businesses", campo de tema claro/grafite) ----------
alter table businesses add column if not exists fundo_estilo text not null default 'branco' check (fundo_estilo in ('branco','grafite'));

-- ---------- MIGRAÇÃO: patrocinadores (AgendaPro e TrainPro, mesma tabela, separados por "produto") ----------
create table if not exists patrocinadores (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto in ('agendapro','trainpro')),
  nome text not null,
  logo_url text,
  link_url text,
  ativo boolean not null default true,
  created_at timestamptz default now()
);
alter table patrocinadores enable row level security;

create policy "publico le patrocinadores ativos" on patrocinadores
  for select using (ativo = true);

create policy "admin gerencia patrocinadores" on patrocinadores
  for all
  using (auth.jwt() ->> 'email' = 'tadeuconcept@gmail.com')
  with check (auth.jwt() ->> 'email' = 'tadeuconcept@gmail.com');

create policy "admin envia logo de patrocinador" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = 'patrocinadores'
    and auth.jwt() ->> 'email' = 'tadeuconcept@gmail.com'
  );

create policy "admin atualiza logo de patrocinador" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = 'patrocinadores'
    and auth.jwt() ->> 'email' = 'tadeuconcept@gmail.com'
  );

-- ---------- MIGRAÇÃO: NutriPro (mesma tabela "businesses" + pacientes/diário alimentar) ----------
alter table patrocinadores drop constraint if exists patrocinadores_produto_check;
alter table patrocinadores add constraint patrocinadores_produto_check check (produto in ('agendapro','trainpro','nutripro'));

-- ---------- MIGRAÇÃO: VitrinePro (mesma tabela "businesses" + vitrine de produtos com carrinho) ----------
alter table patrocinadores drop constraint if exists patrocinadores_produto_check;
alter table patrocinadores add constraint patrocinadores_produto_check check (produto in ('agendapro','trainpro','nutripro','vitrinepro'));

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  nome text not null,
  preco numeric(10,2) not null,
  foto_url text,
  ativo boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_produtos_business on produtos(business_id);
alter table produtos enable row level security;

create policy "dono gerencia produtos" on produtos
  for all using (exists (select 1 from businesses b where b.id = produtos.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = produtos.business_id and b.owner_id = auth.uid()));
create policy "publico le produtos ativos" on produtos
  for select using (ativo = true);

create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  cliente_nome text not null,
  cliente_telefone text not null,
  endereco_entrega text,
  data_entrega date,
  valor_total numeric(10,2) not null default 0,
  status text not null default 'pendente' check (status in ('pendente','pago','entregue','cancelado')),
  mp_link text,
  created_at timestamptz default now()
);
create index if not exists idx_pedidos_business on pedidos(business_id);
alter table pedidos enable row level security;

create policy "dono gerencia pedidos" on pedidos
  for all using (exists (select 1 from businesses b where b.id = pedidos.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = pedidos.business_id and b.owner_id = auth.uid()));
-- sem policy publica de insert de proposito: o pedido e criado pela funcao criar_pedido (security definer)

create table if not exists itens_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text not null,
  quantidade int not null default 1,
  valor_unitario numeric(10,2) not null,
  valor_subtotal numeric(10,2) not null
);
create index if not exists idx_itens_pedido on itens_pedido(pedido_id);
alter table itens_pedido enable row level security;

create policy "dono ve itens dos proprios pedidos" on itens_pedido
  for select using (exists (select 1 from pedidos p join businesses b on b.id = p.business_id where p.id = itens_pedido.pedido_id and b.owner_id = auth.uid()));
create policy "publico ve itens ao criar pedido" on itens_pedido
  for select using (true);

-- Cria o pedido inteiro (cabecalho + itens) calculando o total a partir do preco real no banco,
-- pra ninguem conseguir manipular o preco pelo navegador.
create or replace function public.criar_pedido(
  p_business_id uuid,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_endereco text,
  p_data_entrega date,
  p_itens jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  novo_pedido_id uuid;
  item jsonb;
  prod record;
  total numeric(10,2) := 0;
begin
  insert into pedidos (business_id, cliente_nome, cliente_telefone, endereco_entrega, data_entrega, valor_total, status)
  values (p_business_id, p_cliente_nome, p_cliente_telefone, p_endereco, p_data_entrega, 0, 'pendente')
  returning id into novo_pedido_id;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    select id, nome, preco into prod from produtos
      where id = (item->>'produto_id')::uuid and business_id = p_business_id and ativo = true;
    if prod.id is not null then
      insert into itens_pedido (pedido_id, produto_id, produto_nome, quantidade, valor_unitario, valor_subtotal)
      values (novo_pedido_id, prod.id, prod.nome, (item->>'quantidade')::int, prod.preco, prod.preco * (item->>'quantidade')::int);
      total := total + (prod.preco * (item->>'quantidade')::int);
    end if;
  end loop;

  update pedidos set valor_total = total where id = novo_pedido_id;
  return novo_pedido_id;
end;
$$;
grant execute on function public.criar_pedido(uuid, text, text, text, date, jsonb) to anon, authenticated;

-- Dados publicos da vitrine (nome, cor, logo, whatsapp) a partir do slug
create or replace function public.get_vitrine_publica(p_slug text)
returns table(business_id uuid, nome text, cor text, logo text, whatsapp text)
language sql security definer set search_path = public
as $$
  select id, name, brand_color, logo_url, whatsapp from businesses where slug = p_slug;
$$;
grant execute on function public.get_vitrine_publica(text) to anon, authenticated;

-- Storage: fotos de produtos, mesmo bucket "logos", prefixo "produtos/{business_id}/..."
create policy "dono envia foto de produto" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = 'produtos'
    and exists (select 1 from businesses b where b.owner_id = auth.uid() and b.id::text = (storage.foldername(name))[2])
  );
create policy "dono atualiza foto de produto" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = 'produtos'
    and exists (select 1 from businesses b where b.owner_id = auth.uid() and b.id::text = (storage.foldername(name))[2])
  );

create table if not exists pacientes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  nome text not null,
  telefone text not null,
  created_at timestamptz default now()
);
create index if not exists idx_pacientes_business on pacientes(business_id);
alter table pacientes enable row level security;

create policy "dono gerencia pacientes" on pacientes
  for all using (exists (select 1 from businesses b where b.id = pacientes.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = pacientes.business_id and b.owner_id = auth.uid()));

create table if not exists diario_fotos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references pacientes(id) on delete cascade,
  foto_url text not null,
  nota text,
  created_at timestamptz default now()
);
create index if not exists idx_diario_paciente on diario_fotos(paciente_id);
alter table diario_fotos enable row level security;

create policy "dono ve fotos dos proprios pacientes" on diario_fotos
  for select using (exists (select 1 from pacientes p join businesses b on b.id = p.business_id where p.id = diario_fotos.paciente_id and b.owner_id = auth.uid()));
-- sem policy de insert pública de propósito: o paciente envia a foto via função abaixo (security definer)

create table if not exists evolucao_peso (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references pacientes(id) on delete cascade,
  peso numeric(5,2) not null,
  data date not null default current_date,
  created_at timestamptz default now()
);
create index if not exists idx_evolucao_paciente on evolucao_peso(paciente_id);
alter table evolucao_peso enable row level security;

create policy "dono gerencia evolucao dos proprios pacientes" on evolucao_peso
  for all using (exists (select 1 from pacientes p join businesses b on b.id = p.business_id where p.id = evolucao_peso.paciente_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from pacientes p join businesses b on b.id = p.business_id where p.id = evolucao_peso.paciente_id and b.owner_id = auth.uid()));

-- Link público do diário (sem login): expõe só o necessário, nunca a lista de pacientes de outros.
create or replace function public.get_paciente_publico(p_id uuid)
returns table(
  paciente_nome text,
  business_nome text,
  business_whatsapp text,
  business_logo text,
  business_cor text
)
language sql security definer set search_path = public
as $$
  select p.nome, b.name, b.whatsapp, b.logo_url, b.brand_color
  from pacientes p
  join businesses b on b.id = p.business_id
  where p.id = p_id;
$$;
grant execute on function public.get_paciente_publico(uuid) to anon, authenticated;

create or replace function public.registrar_diario_foto(p_paciente_id uuid, p_foto_url text, p_nota text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare novo_id uuid;
begin
  insert into diario_fotos (paciente_id, foto_url, nota) values (p_paciente_id, p_foto_url, p_nota) returning id into novo_id;
  return novo_id;
end;
$$;
grant execute on function public.registrar_diario_foto(uuid, text, text) to anon, authenticated;

create policy "publico envia foto do diario" on storage.objects
  for insert to anon
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = 'diario');
