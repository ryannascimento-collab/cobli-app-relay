// Lógica do POST /api/app/v1/capturas. O acesso ao banco entra por `Dependencias`, então os testes
// rodam sem Supabase. Ordem das etapas (de propósito): tamanho -> autenticação -> reenvio já salvo
// (não gasta cota) -> limite por aparelho -> leitura do corpo -> validação -> gravação.
//
// NUNCA registrar em log nem devolver o conteúdo dos campos, a foto ou o token.

import {
  LIMITE_CORPO_BYTES,
  LIMITE_ENVIOS_POR_DIA,
  LIMITE_ENVIOS_POR_MINUTO,
  LIMITE_FILA_PENDENTE,
  LIMITE_FOTO_BYTES,
  converterCapturadoEm,
  converterDataRecebimento,
  ehJpeg,
  lerBearer,
  normalizarIdApp,
  normalizarNumeroNf,
  sha256Hex,
  textoOpcional,
} from "./validar";

export type StatusDispositivo = "pendente" | "ativo" | "revogado";

export interface Dispositivo {
  id: string;
  nome: string;
  status: StatusDispositivo;
}

export interface NovaCaptura {
  id_app: string;
  dispositivo_id: string;
  usuario: string | null;
  numero_nf: string;
  data_recebimento: string; // aaaa-mm-dd
  nome_recebedor: string | null;
  caminho_foto: string;
  tamanho_bytes: number;
  hash_foto: string;
  capturado_em: string; // ISO 8601
}

export interface Dependencias {
  /** Dispositivo (em qualquer estado) cujo hash de token bate; quem decide o que fazer é o chamador. */
  buscarDispositivo(hashToken: string): Promise<Dispositivo | null>;
  capturaExiste(dispositivoId: string, idApp: string): Promise<boolean>;
  /** Quantas capturas estão esperando na nuvem (ainda não buscadas pelo servidor). */
  contarPendentes(): Promise<number>;
  registrarEnvio(dispositivoId: string, limiteMinuto: number, limiteDia: number): Promise<"ok" | "minuto" | "dia">;
  gravarFoto(caminho: string, bytes: Uint8Array): Promise<void>;
  inserirCaptura(captura: NovaCaptura): Promise<"criada" | "duplicada">;
  registrarTentativaRecusada(motivo: string, ip: string | null, dispositivoId: string | null): Promise<void>;
  tocarUso(dispositivoId: string): Promise<void>;
  agora(): Date;
}

export function json(corpo: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(corpo, { status, headers: extra });
}

export function ipDe(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  return encaminhado ? encaminhado.split(",")[0].trim().slice(0, 64) : null;
}

export async function processarCaptura(req: Request, deps: Dependencias): Promise<Response> {
  try {
    // 1. Recusa pelo tamanho declarado ANTES de ler o corpo.
    const declarado = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_BYTES) {
      return json({ erro: "corpo_grande_demais" }, 413);
    }

    // 2. Autenticação: o token identifica o aparelho. Mesma resposta para ausente, inválido e revogado.
    const token = lerBearer(req.headers.get("authorization"));
    if (!token) {
      await deps.registrarTentativaRecusada("sem_token", ipDe(req), null);
      return json({ erro: "nao_autorizado" }, 401);
    }
    const dispositivo = await deps.buscarDispositivo(sha256Hex(token));
    if (!dispositivo || dispositivo.status === "revogado") {
      await deps.registrarTentativaRecusada(dispositivo ? "token_revogado" : "token_invalido", ipDe(req), dispositivo?.id ?? null);
      return json({ erro: "nao_autorizado" }, 401);
    }
    // Registrado mas ainda não liberado: o app guarda a fila e tenta depois (não é erro de dado).
    if (dispositivo.status === "pendente") {
      return json({ erro: "aguardando_liberacao" }, 403);
    }

    // 3. Reenvio de algo já salvo: devolve 200 sem gastar cota nem reler o corpo.
    const idDoCabecalho = normalizarIdApp(req.headers.get("idempotency-key"));
    if (idDoCabecalho && (await deps.capturaExiste(dispositivo.id, idDoCabecalho))) {
      await deps.tocarUso(dispositivo.id).catch(() => undefined);
      return json({ id: idDoCabecalho, status: "recebido" }, 200);
    }

    // 3b. Fila cheia (o servidor não está buscando): recusa por enquanto pra não estourar o armazenamento
    //     da nuvem. É espera, não erro de dado: o app guarda e reenvia.
    if ((await deps.contarPendentes()) >= LIMITE_FILA_PENDENTE) {
      await deps.registrarTentativaRecusada("fila_cheia", ipDe(req), dispositivo.id);
      return json({ erro: "fila_cheia" }, 503, { "Retry-After": "600" });
    }

    // 4. Limite por aparelho (cada tentativa conta, inclusive as inválidas).
    const cota = await deps.registrarEnvio(dispositivo.id, LIMITE_ENVIOS_POR_MINUTO, LIMITE_ENVIOS_POR_DIA);
    if (cota !== "ok") {
      await deps.registrarTentativaRecusada(`limite_${cota}`, ipDe(req), dispositivo.id);
      return json({ erro: "muitos_envios" }, 429, { "Retry-After": cota === "minuto" ? "60" : "3600" });
    }

    // 5. Corpo multipart.
    const tipo = req.headers.get("content-type") ?? "";
    if (!tipo.toLowerCase().startsWith("multipart/form-data")) {
      return json({ erro: "esperado_multipart" }, 415);
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ erro: "corpo_invalido" }, 400);
    }

    // 6. Validação. Só numero_nf, data_recebimento, id e foto podem recusar o envio.
    const idApp = normalizarIdApp(form.get("id")) ?? idDoCabecalho;
    const numeroNf = normalizarNumeroNf(form.get("numero_nf"));
    const dataRecebimento = converterDataRecebimento(form.get("data_recebimento"));
    const campos: { campo: string; mensagem: string }[] = [];
    if (!idApp) campos.push({ campo: "id", mensagem: "ausente ou inválido (use letras, números, _ ou -, até 64)" });
    if (!numeroNf) campos.push({ campo: "numero_nf", mensagem: "obrigatório, só dígitos" });
    if (!dataRecebimento) campos.push({ campo: "data_recebimento", mensagem: "obrigatória, formato dd/mm/aaaa e data real" });
    if (campos.length > 0 || !idApp || !numeroNf || !dataRecebimento) {
      return json({ erro: "dados_invalidos", campos }, 422);
    }

    // Reenvio cujo id só veio no corpo (sem o cabeçalho): ainda é idempotente.
    if (idApp !== idDoCabecalho && (await deps.capturaExiste(dispositivo.id, idApp))) {
      await deps.tocarUso(dispositivo.id).catch(() => undefined);
      return json({ id: idApp, status: "recebido" }, 200);
    }

    const foto = form.get("foto");
    if (!(foto instanceof File) || foto.size === 0) {
      return json({ erro: "dados_invalidos", campos: [{ campo: "foto", mensagem: "obrigatória" }] }, 422);
    }
    if (foto.size > LIMITE_FOTO_BYTES) {
      return json({ erro: "foto_grande_demais" }, 413);
    }
    const bytes = new Uint8Array(await foto.arrayBuffer());
    if (!ehJpeg(bytes)) {
      return json({ erro: "foto_nao_e_jpeg" }, 415);
    }

    // 7. Gravação: foto primeiro (sobrescrever é seguro num reenvio), depois a linha.
    const caminho = `${dispositivo.id}/${idApp}.jpg`;
    await deps.gravarFoto(caminho, bytes);
    const resultado = await deps.inserirCaptura({
      id_app: idApp,
      dispositivo_id: dispositivo.id,
      usuario: textoOpcional(form.get("usuario"), 100),
      numero_nf: numeroNf,
      data_recebimento: dataRecebimento,
      nome_recebedor: textoOpcional(form.get("nome_recebedor"), 120),
      caminho_foto: caminho,
      tamanho_bytes: bytes.length,
      hash_foto: sha256Hex(bytes),
      capturado_em: converterCapturadoEm(form.get("capturado_em"), deps.agora()),
    });
    await deps.tocarUso(dispositivo.id).catch(() => undefined);
    return json({ id: idApp, status: "recebido" }, resultado === "criada" ? 201 : 200);
  } catch {
    // Falha do nosso lado (banco/armazenamento fora do ar): o app guarda e reenvia depois.
    return json({ erro: "servico_indisponivel" }, 503);
  }
}
