-- Migração 02: ajusta capturas_app ao contrato real do app (canhoto de NF-e).
-- Rodar no SQL Editor DEPOIS do 01_estrutura.sql. Idempotente: pode rodar de novo.
-- Não guarda CPF/RG (decisão de 2026-10-06: o app deixa de enviar esse campo).

-- 1. O id do app é um timestamp em ms (texto), único POR APARELHO (dois celulares podem repetir o valor).
alter table public.capturas_app drop constraint if exists capturas_app_id_envio_key;
alter table public.capturas_app drop column if exists id_envio;
alter table public.capturas_app add column if not exists id_app text;
alter table public.capturas_app alter column id_app set not null;
alter table public.capturas_app drop constraint if exists capturas_app_id_app_formato;
alter table public.capturas_app
  add constraint capturas_app_id_app_formato check (id_app ~ '^[A-Za-z0-9_-]{1,64}$');
create unique index if not exists capturas_app_dispositivo_id_app_idx
  on public.capturas_app (dispositivo_id, id_app);

-- 2. Campos do canhoto.
alter table public.capturas_app add column if not exists numero_nf text;
alter table public.capturas_app alter column numero_nf set not null;
alter table public.capturas_app drop constraint if exists capturas_app_numero_nf_formato;
alter table public.capturas_app
  add constraint capturas_app_numero_nf_formato check (numero_nf ~ '^[0-9]{1,20}$');

alter table public.capturas_app add column if not exists data_recebimento date;
alter table public.capturas_app alter column data_recebimento set not null;

alter table public.capturas_app add column if not exists nome_recebedor text;
alter table public.capturas_app drop constraint if exists capturas_app_nome_recebedor_tamanho;
alter table public.capturas_app
  add constraint capturas_app_nome_recebedor_tamanho check (nome_recebedor is null or char_length(nome_recebedor) <= 120);

-- 3. "operador" vira "usuario" (nome de quem registrou no app); pode vir vazio e nunca recusa o envio.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'capturas_app' and column_name = 'operador') then
    alter table public.capturas_app rename column operador to usuario;
  end if;
end $$;
alter table public.capturas_app drop constraint if exists capturas_app_operador_check;
alter table public.capturas_app alter column usuario drop not null;
alter table public.capturas_app drop constraint if exists capturas_app_usuario_tamanho;
alter table public.capturas_app
  add constraint capturas_app_usuario_tamanho check (usuario is null or char_length(usuario) <= 100);

-- 4. O JSON livre deixa de existir: os campos agora são colunas.
alter table public.capturas_app drop column if exists dados;

-- 5. Consulta por NF e por data (a ferramenta de Canhotos do Cobli Operações vai usar).
create index if not exists capturas_app_nf_idx on public.capturas_app (numero_nf);
create index if not exists capturas_app_data_idx on public.capturas_app (data_recebimento);
