import { test } from "node:test";
import assert from "node:assert/strict";
import { processarCaptura, type Dependencias, type NovaCaptura, type StatusDispositivo } from "../src/lib/capturas/processar";
import { sha256Hex } from "../src/lib/capturas/validar";

const TOKEN = "token-de-teste";
const DISPOSITIVO = { id: "11111111-1111-1111-1111-111111111111", nome: "Celular de teste" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** Banco falso em memória. */
function criarFalsos(opcoes: { cota?: "ok" | "minuto" | "dia"; falhar?: boolean; status?: StatusDispositivo } = {}) {
  const capturas: NovaCaptura[] = [];
  const fotos = new Map<string, Uint8Array>();
  const recusas: string[] = [];
  let envios = 0;
  const deps: Dependencias = {
    async buscarDispositivo(hash) {
      if (opcoes.falhar) throw new Error("banco fora do ar");
      return hash === sha256Hex(TOKEN) ? { ...DISPOSITIVO, status: opcoes.status ?? "ativo" } : null;
    },
    async capturaExiste(dispositivoId, idApp) {
      return capturas.some((c) => c.dispositivo_id === dispositivoId && c.id_app === idApp);
    },
    async registrarEnvio() {
      envios++;
      return opcoes.cota ?? "ok";
    },
    async gravarFoto(caminho, bytes) {
      fotos.set(caminho, bytes);
    },
    async inserirCaptura(c) {
      if (capturas.some((x) => x.dispositivo_id === c.dispositivo_id && x.id_app === c.id_app)) return "duplicada";
      capturas.push(c);
      return "criada";
    },
    async registrarTentativaRecusada(motivo) {
      recusas.push(motivo);
    },
    async tocarUso() {},
    agora: () => new Date("2026-10-06T12:00:00Z"),
  };
  return { deps, capturas, fotos, recusas, envios: () => envios };
}

interface Opcoes {
  campos?: Record<string, string | null>;
  foto?: Uint8Array | null;
  token?: string | null;
  idempotencyKey?: string | null;
  cabecalhos?: Record<string, string>;
}

function montarRequisicao(o: Opcoes = {}): Request {
  const form = new FormData();
  const campos: Record<string, string | null> = {
    id: "1791322637072",
    numero_nf: "000123",
    data_recebimento: "06/10/2026",
    nome_recebedor: "Maria",
    usuario: "João",
    capturado_em: "2026-10-06T11:00:00Z",
    ...o.campos,
  };
  for (const [k, v] of Object.entries(campos)) if (v !== null) form.append(k, v);
  const foto = o.foto === undefined ? JPEG : o.foto;
  if (foto) form.append("foto", new File([foto as BlobPart], "canhoto.jpg", { type: "image/jpeg" }));
  const headers: Record<string, string> = { ...o.cabecalhos };
  const token = o.token === undefined ? TOKEN : o.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const chave = o.idempotencyKey === undefined ? "1791322637072" : o.idempotencyKey;
  if (chave) headers["idempotency-key"] = chave;
  return new Request("https://exemplo.test/api/app/v1/capturas", { method: "POST", body: form, headers });
}

test("envio normal: 201, campos normalizados e foto guardada", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: "1791322637072", status: "recebido" });
  assert.equal(f.capturas.length, 1);
  const c = f.capturas[0];
  assert.equal(c.numero_nf, "123");
  assert.equal(c.data_recebimento, "2026-10-06");
  assert.equal(c.usuario, "João");
  assert.equal(c.nome_recebedor, "Maria");
  assert.equal(c.caminho_foto, `${DISPOSITIVO.id}/1791322637072.jpg`);
  assert.equal(c.hash_foto, sha256Hex(JPEG));
  assert.equal(f.fotos.size, 1);
});

test("reenvio duplicado: 200 com o mesmo id, sem criar segundo registro e sem gastar cota", async () => {
  const f = criarFalsos();
  assert.equal((await processarCaptura(montarRequisicao(), f.deps)).status, 201);
  const enviosAntes = f.envios();
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "1791322637072", status: "recebido" });
  assert.equal(f.capturas.length, 1);
  assert.equal(f.envios(), enviosAntes);
});

test("reenvio sem o cabeçalho Idempotency-Key (id só no corpo): continua idempotente", async () => {
  const f = criarFalsos();
  await processarCaptura(montarRequisicao({ idempotencyKey: null }), f.deps);
  const r = await processarCaptura(montarRequisicao({ idempotencyKey: null }), f.deps);
  assert.equal(r.status, 200);
  assert.equal(f.capturas.length, 1);
});

test("campos opcionais vazios ou ausentes não causam erro", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(
    montarRequisicao({ campos: { nome_recebedor: "", usuario: null, capturado_em: null } }),
    f.deps,
  );
  assert.equal(r.status, 201);
  assert.equal(f.capturas[0].nome_recebedor, null);
  assert.equal(f.capturas[0].usuario, null);
  assert.equal(f.capturas[0].capturado_em, "2026-10-06T12:00:00.000Z");
});

test("numero_nf ausente: 422 com mensagem clara", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(montarRequisicao({ campos: { numero_nf: null } }), f.deps);
  assert.equal(r.status, 422);
  const corpo = (await r.json()) as { campos: { campo: string }[] };
  assert.equal(corpo.campos[0].campo, "numero_nf");
  assert.equal(f.capturas.length, 0);
});

test("data_recebimento inexistente (31/02): 422", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(montarRequisicao({ campos: { data_recebimento: "31/02/2026" } }), f.deps);
  assert.equal(r.status, 422);
});

test("foto que não é JPEG: 415; foto ausente: 422", async () => {
  const f = criarFalsos();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal((await processarCaptura(montarRequisicao({ foto: png }), f.deps)).status, 415);
  assert.equal((await processarCaptura(montarRequisicao({ foto: null }), f.deps)).status, 422);
  assert.equal(f.capturas.length, 0);
  assert.equal(f.fotos.size, 0);
});

test("foto acima do limite: 413", async () => {
  const f = criarFalsos();
  const grande = new Uint8Array(4 * 1024 * 1024 + 1);
  grande.set([0xff, 0xd8, 0xff]);
  assert.equal((await processarCaptura(montarRequisicao({ foto: grande }), f.deps)).status, 413);
});

test("Content-Length acima do limite é recusado antes de ler o corpo: 413", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(montarRequisicao({ cabecalhos: { "content-length": "99999999" } }), f.deps);
  assert.equal(r.status, 413);
  assert.equal(f.envios(), 0);
});

test("token errado ou ausente: 401, mesma resposta, e a tentativa é registrada", async () => {
  const f = criarFalsos();
  const errado = await processarCaptura(montarRequisicao({ token: "outro" }), f.deps);
  const ausente = await processarCaptura(montarRequisicao({ token: null }), f.deps);
  assert.equal(errado.status, 401);
  assert.equal(ausente.status, 401);
  assert.deepEqual(await errado.json(), await ausente.json());
  assert.deepEqual(f.recusas, ["token_invalido", "sem_token"]);
  assert.equal(f.capturas.length, 0);
});

test("limite de envios por aparelho: 429 com Retry-After", async () => {
  const f = criarFalsos({ cota: "minuto" });
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "60");
  assert.deepEqual(f.recusas, ["limite_minuto"]);
  assert.equal(f.capturas.length, 0);
});

test("falha do banco: 503 (o app guarda e reenvia depois)", async () => {
  const f = criarFalsos({ falhar: true });
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 503);
});

test("a resposta e os registros nunca trazem o token", async () => {
  const f = criarFalsos();
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal((await r.text()).includes(TOKEN), false);
  assert.equal(JSON.stringify(f.capturas).includes(TOKEN), false);
});

test("aparelho pendente: 403 aguardando_liberacao, sem gravar e sem gastar cota", async () => {
  const f = criarFalsos({ status: "pendente" });
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { erro: "aguardando_liberacao" });
  assert.equal(f.capturas.length, 0);
  assert.equal(f.fotos.size, 0);
  assert.equal(f.envios(), 0);
});

test("aparelho revogado: 401 igual ao token inválido, e a recusa é registrada", async () => {
  const f = criarFalsos({ status: "revogado" });
  const r = await processarCaptura(montarRequisicao(), f.deps);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { erro: "nao_autorizado" });
  assert.deepEqual(f.recusas, ["token_revogado"]);
  assert.equal(f.capturas.length, 0);
});
