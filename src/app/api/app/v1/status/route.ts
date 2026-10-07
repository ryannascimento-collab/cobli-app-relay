// GET /api/app/v1/status — o app consulta se o aparelho já foi liberado (pendente | ativo | revogado).
import { processarStatus } from "@/lib/capturas/registrar";
import { criarDependencias } from "@/lib/capturas/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let deps;
  try {
    deps = criarDependencias();
  } catch {
    return Response.json({ erro: "servico_indisponivel" }, { status: 503 });
  }
  return processarStatus(req, deps);
}
