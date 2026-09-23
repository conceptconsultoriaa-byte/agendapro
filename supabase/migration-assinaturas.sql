-- Rodar uma vez no SQL Editor do Supabase — adiciona o controle de assinatura
-- (mensalidade que o dono do negócio paga para usar o AgendaPro).

alter table businesses
  add column if not exists subscription_status text not null default 'trial'
    check (subscription_status in ('trial','ativo','inadimplente','cancelado')),
  add column if not exists subscription_plan text,
  add column if not exists mp_preapproval_id text;

create index if not exists idx_business_mp_preapproval on businesses(mp_preapproval_id);
