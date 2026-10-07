-- Migração 04: ajustes da revisão de 2026-10-07. Rodar no SQL Editor do Supabase da NUVEM.
-- Idempotente: pode rodar de novo.

-- A função app_registrar_envio apaga, a cada envio, as linhas de contagem com mais de 2 dias
-- ("where em < ..."), mas o único índice da tabela começa por dispositivo_id: sem este, cada envio
-- varre a tabela inteira. Barato agora, evita lentidão com o tempo.
create index if not exists app_envios_log_em_idx on public.app_envios_log (em);
