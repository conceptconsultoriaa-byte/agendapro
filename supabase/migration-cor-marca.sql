-- Rodar uma vez no SQL Editor do Supabase — permite cada assinante escolher sua própria cor de destaque.
alter table businesses
  add column if not exists brand_color text not null default '#C6E619';
