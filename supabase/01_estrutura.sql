-- Estrutura do projeto Supabase NA NUVEM usado pelo relay do aplicativo Android.
-- Rodar uma vez no SQL Editor do projeto. É idempotente: pode rodar de novo sem estragar nada.
--
-- Princípio: nada aqui é acessível pela chave pública (anon) nem por usuários logados.
-- O RLS fica ligado e SEM políticas; só a chave service_role (que ignora o RLS) lê e grava,
-- e ela vive apenas nas variáveis de ambiente da Vercel e no servidor da Produção.

-- 1. Aparelhos cadastrados -----------------------------------------------------------------
create table if not exists public.app_dispositivos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 60),   -- rótulo do aparelho (ex.: "Celular do João")
  chave_hash text not null unique,                                   -- SHA-256 (hex) da chave; a chave em si nunca é guardada
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  ultimo_uso_em timestamptz
);

-- 2. Capturas em trânsito (fila que o servidor da Produção esvazia) ------------------------
create table if not exists public.capturas_app (
  id uuid primary key default gen_random_uuid(),
  id_envio uuid not null unique,                                     -- gerado pelo app; repetição não duplica
  dispositivo_id uuid not null references public.app_dispositivos (id),
  operador text not null check (char_length(operador) between 2 and 60),
  dados jsonb not null default '{}'::jsonb,                          -- o que o app leu da foto (formato a definir)
  caminho_foto text not null,                                        -- caminho no bucket "capturas"
  tamanho_bytes integer not null check (tamanho_bytes > 0),
  hash_foto text,                                                    -- SHA-256 (hex) da foto
  capturado_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'baixada'))
);
create index if not exists capturas_app_status_idx on public.capturas_app (status, recebido_em);

-- 3. Tentativas recusadas (auditoria de abuso) ----------------------------------------------
create table if not exists public.app_tentativas_recusadas (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  ip text,
  motivo text not null,                                              -- ex.: chave_invalida, limite_minuto, limite_dia
  dispositivo_id uuid
);
create index if not exists app_tentativas_ocorrido_idx on public.app_tentativas_recusadas (ocorrido_em);

-- 4. Contagem de envios por aparelho (para os limites) ---------------------------------------
-- Funções da Vercel não guardam estado entre chamadas, então o limite é contado aqui.
create table if not exists public.app_envios_log (
  id bigint generated always as identity primary key,
  dispositivo_id uuid not null,
  em timestamptz not null default now()
);
create index if not exists app_envios_log_idx on public.app_envios_log (dispositivo_id, em);

-- Confere os limites e, se couber, registra o envio. Devolve 'ok', 'minuto' ou 'dia'.
create or replace function public.app_registrar_envio(
  p_dispositivo uuid,
  p_limite_minuto integer default 20,
  p_limite_dia integer default 2000
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_minuto integer;
  v_dia integer;
begin
  select count(*) filter (where em > now() - interval '1 minute'), count(*)
    into v_minuto, v_dia
    from public.app_envios_log
   where dispositivo_id = p_dispositivo and em > now() - interval '1 day';

  if v_dia >= p_limite_dia then return 'dia'; end if;
  if v_minuto >= p_limite_minuto then return 'minuto'; end if;

  insert into public.app_envios_log (dispositivo_id) values (p_dispositivo);
  delete from public.app_envios_log where em < now() - interval '2 days';
  return 'ok';
end;
$$;

-- 5. Acesso: tudo fechado para anon e usuários logados --------------------------------------
alter table public.app_dispositivos enable row level security;
alter table public.capturas_app enable row level security;
alter table public.app_tentativas_recusadas enable row level security;
alter table public.app_envios_log enable row level security;

revoke all on public.app_dispositivos from anon, authenticated;
revoke all on public.capturas_app from anon, authenticated;
revoke all on public.app_tentativas_recusadas from anon, authenticated;
revoke all on public.app_envios_log from anon, authenticated;
revoke all on function public.app_registrar_envio(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.app_registrar_envio(uuid, integer, integer) to service_role;

-- 6. Bucket privado das fotos (8 MB, só JPEG) ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capturas', 'capturas', false, 8388608, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- Sem políticas em storage.objects para esse bucket: só a service_role acessa.
