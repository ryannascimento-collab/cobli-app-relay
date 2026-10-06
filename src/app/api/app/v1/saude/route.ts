// GET /api/app/v1/saude — sem autenticação. Diz ao aplicativo e ao monitoramento que o relay está no ar.
// Por enquanto só confirma que a função responde; quando o banco existir, passa a conferi-lo também.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, versao: 1 });
}
