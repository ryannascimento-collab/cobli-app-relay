-- Migração 03: registro automático dos aparelhos, com liberação manual.
-- Rodar no SQL Editor DEPOIS do 02_canhotos.sql. Idempotente: pode rodar de novo.
--
-- Fluxo: o app se registra sozinho (POST /api/app/v1/registrar) usando a "chave de implantação" que vai
-- dentro do APK; o aparelho nasce 'pendente' e só envia depois de ser liberado (status = 'ativo').

-- 1. Estado do aparelho: pendente -> ativo -> revogado. Substitui a coluna booleana "ativo".
alter table public.app_dispositivos add column if not exists status text;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'app_dispositivos' and column_name = 'ativo') then
    -- Aparelhos que já existiam (cadastrados à mão) mantêm o estado que tinham.
    execute $q$
      update public.app_dispositivos
         set status = case when ativo = false or revogado_em is not null then 'revogado' else 'ativo' end
       where status is null
    $q$;
  end if;
end $$;

update public.app_dispositivos set status = 'pendente' where status is null;
alter table public.app_dispositivos alter column status set default 'pendente';  -- fecha por padrão
alter table public.app_dispositivos alter column status set not null;
alter table public.app_dispositivos drop constraint if exists app_dispositivos_status_valido;
alter table public.app_dispositivos
  add constraint app_dispositivos_status_valido check (status in ('pendente', 'ativo', 'revogado'));
alter table public.app_dispositivos drop column if exists ativo;

-- 2. Dados do registro automático.
alter table public.app_dispositivos add column if not exists modelo text;
alter table public.app_dispositivos add column if not exists id_instalacao text;
alter table public.app_dispositivos add column if not exists ip_registro text;
alter table public.app_dispositivos add column if not exists liberado_em timestamptz;
alter table public.app_dispositivos add column if not exists chave_implantacao_id uuid;
alter table public.app_dispositivos drop constraint if exists app_dispositivos_id_instalacao_formato;
alter table public.app_dispositivos
  add constraint app_dispositivos_id_instalacao_formato
  check (id_instalacao is null or id_instalacao ~ '^[A-Za-z0-9_-]{8,64}$');
create unique index if not exists app_dispositivos_id_instalacao_idx
  on public.app_dispositivos (id_instalacao) where id_instalacao is not null;
create index if not exists app_dispositivos_status_idx on public.app_dispositivos (status, criado_em);
create index if not exists app_dispositivos_ip_idx on public.app_dispositivos (ip_registro, criado_em);

-- 3. Chaves de implantação (a que vai dentro do APK). Só o hash é guardado; dá para revogar.
create table if not exists public.app_chaves_implantacao (
  id uuid primary key default gen_random_uuid(),
  rotulo text not null check (char_length(rotulo) between 2 and 60),
  chave_hash text not null unique,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  revogada_em timestamptz
);
alter table public.app_chaves_implantacao enable row level security;
revoke all on public.app_chaves_implantacao from anon, authenticated;
