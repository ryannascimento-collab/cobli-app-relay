// Liga `Dependencias` ao Supabase NA NUVEM (projeto do relay, não o da Produção).
// Usa a chave de serviço, que só existe nas variáveis de ambiente da Vercel.

import { createClient } from "@supabase/supabase-js";
import type { Dependencias } from "./processar";

const BUCKET = "capturas";
/** Se já houve tantas recusas no último minuto, para de gravar novas (evita encher o banco num ataque). */
const MAX_RECUSAS_REGISTRADAS_POR_MINUTO = 50;

export function criarDependencias(): Dependencias {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error("variaveis_ausentes");

  const db = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async buscarDispositivo(hashToken) {
      const { data, error } = await db
        .from("app_dispositivos")
        .select("id, nome")
        .eq("chave_hash", hashToken)
        .eq("ativo", true)
        .is("revogado_em", null)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id as string, nome: data.nome as string } : null;
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

    async registrarTentativaRecusada(motivo, ip, dispositivoId) {
      try {
        const desde = new Date(Date.now() - 60_000).toISOString();
        const { count } = await db
          .from("app_tentativas_recusadas")
          .select("id", { count: "exact", head: true })
          .gte("ocorrido_em", desde);
        if ((count ?? 0) >= MAX_RECUSAS_REGISTRADAS_POR_MINUTO) return;
        await db.from("app_tentativas_recusadas").insert({ motivo, ip, dispositivo_id: dispositivoId });
      } catch {
        // O registro de auditoria nunca pode derrubar a resposta.
      }
    },

    async tocarUso(dispositivoId) {
      await db.from("app_dispositivos").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", dispositivoId);
    },

    agora: () => new Date(),
  };
}
