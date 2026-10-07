// Liga `Dependencias` ao Supabase NA NUVEM (projeto do relay, não o da Produção).
// Usa a chave de serviço, que só existe nas variáveis de ambiente da Vercel.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Dependencias, StatusDispositivo } from "./processar";
import { gerarTokenAleatorio, type DependenciasRegistro } from "./registrar";

const BUCKET = "capturas";
/** Se já houve tantas recusas no último minuto, para de gravar novas (evita encher o banco num ataque). */
const MAX_RECUSAS_REGISTRADAS_POR_MINUTO = 50;

function criarCliente(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error("variaveis_ausentes");
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Registra uma recusa para auditoria, sem nunca derrubar a resposta e sem encher o banco num ataque. */
async function registrarRecusa(db: SupabaseClient, motivo: string, ip: string | null, dispositivoId: string | null) {
  try {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const { count } = await db
      .from("app_tentativas_recusadas")
      .select("id", { count: "exact", head: true })
      .gte("ocorrido_em", desde);
    if ((count ?? 0) >= MAX_RECUSAS_REGISTRADAS_POR_MINUTO) return;
    await db.from("app_tentativas_recusadas").insert({ motivo, ip, dispositivo_id: dispositivoId });
    // De vez em quando (2% das recusas) apaga as de mais de 30 dias: a tabela não cresce pra sempre.
    if (Math.random() < 0.02) {
      const corte = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      await db.from("app_tentativas_recusadas").delete().lt("ocorrido_em", corte);
    }
  } catch {
    // O registro de auditoria nunca pode derrubar a resposta.
  }
}

export function criarDependenciasRegistro(): DependenciasRegistro {
  const db = criarCliente();
  return {
    async buscarChaveImplantacao(hash) {
      const { data, error } = await db
        .from("app_chaves_implantacao")
        .select("id")
        .eq("chave_hash", hash)
        .eq("ativa", true)
        .is("revogada_em", null)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id as string } : null;
    },

    async buscarPorInstalacao(idInstalacao) {
      const { data, error } = await db
        .from("app_dispositivos")
        .select("id, status")
        .eq("id_instalacao", idInstalacao)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id as string, status: data.status as StatusDispositivo } : null;
    },

    async contarNovosDoIpNaUltimaHora(ip) {
      const desde = new Date(Date.now() - 3_600_000).toISOString();
      const { count, error } = await db
        .from("app_dispositivos")
        .select("id", { count: "exact", head: true })
        .eq("ip_registro", ip)
        .gte("criado_em", desde);
      if (error) throw error;
      return count ?? 0;
    },

    async contarPendentes() {
      const { count, error } = await db
        .from("app_dispositivos")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (error) throw error;
      return count ?? 0;
    },

    async criarDispositivo(d) {
      const nome = d.nome ?? `Aparelho ${d.id_instalacao.slice(0, 8)}`;
      const { error } = await db.from("app_dispositivos").insert({ ...d, nome, status: "pendente" });
      if (error) throw error;
    },

    async reemitirTokenPendente(id, novoHash) {
      const { error } = await db.from("app_dispositivos").update({ chave_hash: novoHash }).eq("id", id).eq("status", "pendente");
      if (error) throw error;
    },

    registrarTentativaRecusada: (motivo, ip, dispositivoId) => registrarRecusa(db, motivo, ip, dispositivoId),
    gerarToken: gerarTokenAleatorio,
  };
}

export function criarDependencias(): Dependencias {
  const db = criarCliente();

  return {
    async buscarDispositivo(hashToken) {
      const { data, error } = await db
        .from("app_dispositivos")
        .select("id, nome, status")
        .eq("chave_hash", hashToken)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { id: data.id as string, nome: data.nome as string, status: data.status as StatusDispositivo }
        : null;
    },

    async capturaExiste(dispositivoId, idApp) {
      const { count, error } = await db
        .from("capturas_app")
        .select("id", { count: "exact", head: true })
        .eq("dispositivo_id", dispositivoId)
        .eq("id_app", idApp);
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async contarPendentes() {
      const { count, error } = await db
        .from("capturas_app")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (error) throw error;
      return count ?? 0;
    },

    async registrarEnvio(dispositivoId, limiteMinuto, limiteDia) {
      const { data, error } = await db.rpc("app_registrar_envio", {
        p_dispositivo: dispositivoId,
        p_limite_minuto: limiteMinuto,
        p_limite_dia: limiteDia,
      });
      if (error) throw error;
      return data === "minuto" || data === "dia" ? data : "ok";
    },

    async gravarFoto(caminho, bytes) {
      const { error } = await db.storage.from(BUCKET).upload(caminho, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) throw error;
    },

    async inserirCaptura(captura) {
      const { error } = await db.from("capturas_app").insert(captura);
      if (!error) return "criada";
      if (error.code === "23505") return "duplicada"; // unicidade (aparelho, id_app): chegou duas vezes
      throw error;
    },

    registrarTentativaRecusada: (motivo, ip, dispositivoId) => registrarRecusa(db, motivo, ip, dispositivoId),

    async tocarUso(dispositivoId) {
      await db.from("app_dispositivos").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", dispositivoId);
    },

    agora: () => new Date(),
  };
}
