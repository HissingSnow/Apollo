-- Área do Cliente Apollo — tabela de cadastros/assinaturas.
-- Rodar uma vez em: Supabase → SQL Editor → New query → colar tudo → Run.

create table if not exists public.signups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  email               text not null,
  status              text not null default 'aguardando_pagamento'
                      check (status in ('aguardando_pagamento','pago','provisionando','falha_temporaria','falha',
                                        'ativo','pagamento_pendente','cancelado','expirado')),
  plan_key            text not null check (plan_key in ('essencial','profissional','gestao')),
  person_type         text not null check (person_type in ('pf','pj')),
  document            text not null,                 -- CPF ou CNPJ, só números
  company_name        text not null,
  slug                text not null,                 -- código de acesso da empresa no Apollo Drive
  admin_full_name     text not null,
  admin_username      text not null,
  admin_password_hash text,                          -- hash scrypt (formato Werkzeug); apagado após criar a empresa
  primary_color       text not null default '#5B21B6',
  secondary_color     text not null default '#0891B2',
  logo_base64         text,                          -- apagado após criar a empresa
  logo_mime           text,
  accepted_terms_at   timestamptz not null,
  stripe_customer_id  text,
  stripe_subscription_id text,
  stripe_session_id   text,
  next_due_on         date,
  apollo_company_id   bigint,
  last_error          text,
  paid_at             timestamptz,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists signups_user_idx on public.signups (user_id);
create index if not exists signups_slug_idx on public.signups (lower(slug));
create index if not exists signups_username_idx on public.signups (lower(admin_username));
create unique index if not exists signups_subscription_uidx on public.signups (stripe_subscription_id) where stripe_subscription_id is not null;

-- Segurança: RLS ligada e SEM políticas = o navegador não lê nem grava nada aqui.
-- Apenas as funções da Netlify (com a chave service_role) acessam a tabela.
alter table public.signups enable row level security;
