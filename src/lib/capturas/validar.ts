// Validações puras do envio de canhotos. Sem acesso a banco nem a rede: fácil de testar.
// Regra do app: SÓ numero_nf e data_recebimento (e a foto) podem causar erro; tudo o mais é tolerante,
// porque um 4xx faz o app tentar de novo para sempre.

import { createHash } from "node:crypto";

/** Teto da foto. As funções da Vercel aceitam ~4,5 MB de corpo; a foto do app (~1600 px) fica bem abaixo. */
export const LIMITE_FOTO_BYTES = 4 * 1024 * 1024;
/** Teto do corpo inteiro (foto + campos), conferido pelo Content-Length antes de ler. */
export const LIMITE_CORPO_BYTES = LIMITE_FOTO_BYTES + 256 * 1024;

/** Teto de capturas esperando na nuvem pra o servidor buscar. Protege o armazenamento do Supabase da nuvem se a busca parar: acima disso o relay responde 503 e o app tenta de novo depois. */
export const LIMITE_FILA_PENDENTE = 800;

export const LIMITE_ENVIOS_POR_MINUTO = 60;
export const LIMITE_ENVIOS_POR_DIA = 2000;

/** Número da NF: só dígitos, sem zeros à esquerda, até 20 dígitos. Devolve null se inválido. */
export function normalizarNumeroNf(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!/^[0-9]+$/.test(texto)) return null;
  const semZeros = texto.replace(/^0+/, "");
  if (semZeros.length === 0 || semZeros.length > 20) return null;
  return semZeros;
}

/** dd/mm/aaaa -> aaaa-mm-dd, só se for uma data real (31/02 não vale). Devolve null se inválida. */
export function converterDataRecebimento(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (ano < 2000 || ano > 2100) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Identificador do canhoto no aparelho (timestamp em ms). Vai no caminho da foto, então é restrito. */
export function normalizarIdApp(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(texto) ? texto : null;
}

/** Texto opcional: vazio vira null, e o que passa do limite é cortado (nunca causa erro). */
export function textoOpcional(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim().replace(/\s+/g, " ");
  if (texto.length === 0) return null;
  return texto.slice(0, max);
}

/** capturado_em em ISO 8601; se faltar ou for inválido, usa o momento do recebimento (nunca causa erro). */
export function converterCapturadoEm(valor: unknown, agora: Date): string {
  if (typeof valor === "string" && valor.trim().length > 0) {
    const d = new Date(valor.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return agora.toISOString();
}

/** JPEG de verdade: confere os primeiros bytes (FF D8 FF), não o nome nem o tipo declarado. */
export function ehJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Extrai o token do cabeçalho "Authorization: Bearer <token>". */
export function lerBearer(cabecalho: string | null): string | null {
  if (!cabecalho) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(cabecalho.trim());
  return m ? m[1] : null;
}

/** SHA-256 em hexadecimal. O banco guarda só o hash do token, nunca o token. */
export function sha256Hex(entrada: string | Uint8Array): string {
  return createHash("sha256").update(entrada).digest("hex");
}
