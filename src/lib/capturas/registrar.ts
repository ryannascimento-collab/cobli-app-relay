// Registro automático do aparelho (POST /api/app/v1/registrar) e consulta de estado (GET /status).
//
// O app se registra sozinho na primeira abertura, apresentando a "chave de implantação" que vai dentro do
// APK. Isso NÃO libera o aparelho: ele nasce 'pendente' e só envia depois que um administrador o libera.
// A chave de implantação só impede que robôs da internet lotem o cadastro; quem tem o APK a extrai, e por
// isso ela é revogável (solta-se um APK novo com outra chave) e a liberação manual é a defesa de verdade.
//
// NUNCA registrar em log nem devolver chaves ou tokens além da resposta única do registro.

import { randomBytes } from "node:crypto";
import { ipDe, json, type Dependencias, type StatusDispositivo } from "./processar";
import { lerBearer, sha256Hex, textoOpcional } from "./validar";

export const LIMITE_REGISTROS_NOVOS_POR_IP_HORA = 5;
export const LIMITE_APARELHOS_PENDENTES = 20;
const LIMITE_CORPO_REGISTRO_BYTES = 4096;

export interface NovoDispositivo {
  nome: string | null;
  modelo: string | null;
  id_instalacao: string;
  ip_registro: string | null;
  chave_hash: string;
  chave_implantacao_id: string;
}

export interface DependenciasRegistro {
  buscarChaveImplantacao(hash: string): Promise<{ id: string } | null>;
  buscarPorInstalacao(idInstalacao: string): Promise<{ id: string; status: StatusDispositivo } | null>;
  contarNovosDoIpNaUltimaHora(ip: string): Promise<number>;
  contarPendentes(): Promise<number>;
  criarDispositivo(d: NovoDispositivo): Promise<void>;
  /** Só vale para aparelho ainda pendente (resposta perdida no registro): troca o hash do token. */
  reemitirTokenPendente(id: string, novoHash: string): Promise<void>;
  registrarTentativaRecusada(motivo: string, ip: string | null, dispositivoId: string | null): Promise<void>;
  gerarToken(): string;
}

export function gerarTokenAleatorio(): string {
  return randomBytes(32).toString("base64url");
}

export async function processarRegistro(req: Request, deps: DependenciasRegistro): Promise<Response> {
  try {
    const declarado = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_REGISTRO_BYTES) {
      return json({ erro: "corpo_grande_demais" }, 413);
    }
    const ip = ipDe(req);

    // 1. Chave de implantação (cabeçalho X-Chave-Implantacao). Mesma resposta para ausente e inválida.
    const chave = req.headers.get("x-chave-implantacao")?.trim();
    const chaveRegistrada = chave ? await deps.buscarChaveImplantacao(sha256Hex(chave)) : null;
    if (!chaveRegistrada) {
      await deps.registrarTentativaRecusada(chave ? "chave_implantacao_invalida" : "sem_chave_implantacao", ip, null);
      return json({ erro: "nao_autorizado" }, 401);
    }

    // 2. Corpo JSON: { id_instalacao (obrigatório), nome?, modelo? }.
    let corpo: unknown;
    try {
      corpo = await req.json();
    } catch {
      return json({ erro: "corpo_invalido" }, 400);
    }
    const dados = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
    const idInstalacao = typeof dados.id_instalacao === "string" ? dados.id_instalacao.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(idInstalacao)) {
      return json(
        { erro: "dados_invalidos", campos: [{ campo: "id_instalacao", mensagem: "obrigatório: 8 a 64 caracteres (letras, números, _ ou -)" }] },
        422,
      );
    }

    // 3. Instalação já conhecida: se ainda está pendente, reemite o token (a resposta anterior pode ter
    //    se perdido). Se já foi liberada ou revogada, o token não é recuperável por aqui.
    const existente = await deps.buscarPorInstalacao(idInstalacao);
    if (existente) {
      if (existente.status !== "pendente") {
        return json({ erro: "aparelho_ja_registrado" }, 409);
      }
      const token = deps.gerarToken();
      await deps.reemitirTokenPendente(existente.id, sha256Hex(token));
      return json({ token, status: "pendente" }, 200);
    }

    // 4. Aparelho novo: limites para um robô não lotar o cadastro.
    if ((await deps.contarNovosDoIpNaUltimaHora(ip ?? "desconhecido")) >= LIMITE_REGISTROS_NOVOS_POR_IP_HORA) {
      await deps.registrarTentativaRecusada("limite_registros_ip", ip, null);
      return json({ erro: "muitos_registros" }, 429, { "Retry-After": "3600" });
    }
    if ((await deps.contarPendentes()) >= LIMITE_APARELHOS_PENDENTES) {
      await deps.registrarTentativaRecusada("cadastro_cheio", ip, null);
      return json({ erro: "cadastro_cheio" }, 503, { "Retry-After": "3600" });
    }

    const token = deps.gerarToken();
    await deps.criarDispositivo({
      nome: textoOpcional(dados.nome, 60),
      modelo: textoOpcional(dados.modelo, 80),
      id_instalacao: idInstalacao,
      ip_registro: ip,
      chave_hash: sha256Hex(token),
      chave_implantacao_id: chaveRegistrada.id,
    });
    return json({ token, status: "pendente" }, 201);
  } catch {
    return json({ erro: "servico_indisponivel" }, 503);
  }
}

/** GET /status — o app pergunta se já foi liberado. Só o dono do token vê o próprio estado. */
export async function processarStatus(req: Request, deps: Pick<Dependencias, "buscarDispositivo">): Promise<Response> {
  try {
    const token = lerBearer(req.headers.get("authorization"));
    const dispositivo = token ? await deps.buscarDispositivo(sha256Hex(token)) : null;
    if (!dispositivo) return json({ erro: "nao_autorizado" }, 401);
    return json({ status: dispositivo.status }, 200);
  } catch {
    return json({ erro: "servico_indisponivel" }, 503);
  }
}
