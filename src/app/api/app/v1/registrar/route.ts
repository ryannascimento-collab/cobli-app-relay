// POST /api/app/v1/registrar — o app se registra sozinho na primeira abertura (fica 'pendente' até a liberação).
// Regras em src/lib/capturas/registrar.ts e no spec api-app-android.md do repositório cobli-operacoes.
import { processarRegistro } from "@/lib/capturas/registrar";
import { criarDependenciasRegistro } from "@/lib/capturas/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  let deps;
  try {
    deps = criarDependenciasRegistro();
  } catch {
    return Response.json({ erro: "servico_indisponivel" }, { status: 503 });
  }
  return processarRegistro(req, deps);
}
