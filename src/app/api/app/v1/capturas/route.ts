// POST /api/app/v1/capturas — recebe o canhoto (foto + campos) do aplicativo Android.
// Contrato e regras: specs/api-app-android.md do repositório cobli-operacoes. A lógica fica em
// src/lib/capturas/processar.ts. Só existe POST: não há nenhuma rota de leitura pública.
import { processarCaptura } from "@/lib/capturas/processar";
import { criarDependencias } from "@/lib/capturas/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  let deps;
  try {
    deps = criarDependencias();
  } catch {
    return Response.json({ erro: "servico_indisponivel" }, { status: 503 });
  }
  return processarCaptura(req, deps);
}
