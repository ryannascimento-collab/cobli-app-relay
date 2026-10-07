import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITE_APARELHOS_PENDENTES,
  LIMITE_REGISTROS_NOVOS_POR_IP_HORA,
  processarRegistro,
  processarStatus,
  type DependenciasRegistro,
  type NovoDispositivo,
} from "../src/lib/capturas/registrar";
import type { StatusDispositivo } from "../src/lib/capturas/processar";
import { sha256Hex } from "../src/lib/capturas/validar";

const CHAVE = "chave-de-implantacao-de-teste";
const INSTALACAO = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

interface Linha extends NovoDispositivo {
  id: string;
  status: StatusDispositivo;
}

function criarFalsos(opcoes: { pendentesExtras?: number; registrosDoIp?: number; falhar?: boolean } = {}) {
  const aparelhos: Linha[] = [];
  const recusas: string[] = [];
  let contador = 0;
  let sequencia = 0;
  const deps: DependenciasRegistro = {
    async buscarChaveImplantacao(hash) {
      if (opcoes.falhar) throw new Error("banco fora do ar");
      return hash === sha256Hex(CHAVE) ? { id: "chave-1" } : null;
    },
    async buscarPorInstalacao(id) {
      const a = aparelhos.find((x) => x.id_instalacao === id);
      return a ? { id: a.id, status: a.status } : null;
    },
    async contarNovosDoIpNaUltimaHora() {
      return (opcoes.registrosDoIp ?? 0) + aparelhos.length;
    },
    async contarPendentes() {
      return (opcoes.pendentesExtras ?? 0) + aparelhos.filter((a) => a.status === "pendente").length;
    },
    async criarDispositivo(d) {
      contador++;
      aparelhos.push({ ...d, id: `disp-${contador}`, status: "pendente" });
    },
    async reemitirTokenPendente(id, novoHash) {
      const a = aparelhos.find((x) => x.id === id);
      if (a) a.chave_hash = novoHash;
    },
    async registrarTentativaRecusada(motivo) {
      recusas.push(motivo);
    },
    gerarToken: () => `token-${++sequencia}`,
  };
  return { deps, aparelhos, recusas };
}

function requisicao(corpo: unknown, chave: string | null = CHAVE, extras: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...extras };
  if (chave) headers["x-chave-implantacao"] = chave;
  return new Request("https://exemplo.test/api/app/v1/registrar", {
    method: "POST",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers,
  });
}

test("registro novo: 201, token devolvido uma vez e aparelho nasce pendente com só o hash", async () => {
  const f = criarFalsos();
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO, nome: "João", modelo: "Moto G" }), f.deps);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { token: "token-1", status: "pendente" });
  assert.equal(f.aparelhos.length, 1);
  assert.equal(f.aparelhos[0].status, "pendente");
  assert.equal(f.aparelhos[0].chave_hash, sha256Hex("token-1"));
  assert.equal(f.aparelhos[0].nome, "João");
  assert.equal(f.aparelhos[0].chave_implantacao_id, "chave-1");
  assert.equal(JSON.stringify(f.aparelhos).includes('"token-1"'), false);
});

test("sem chave de implantação ou com chave errada: 401 igual, e registrado", async () => {
  const f = criarFalsos();
  const sem = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }, null), f.deps);
  const errada = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }, "outra"), f.deps);
  assert.equal(sem.status, 401);
  assert.equal(errada.status, 401);
  assert.deepEqual(await sem.json(), await errada.json());
  assert.deepEqual(f.recusas, ["sem_chave_implantacao", "chave_implantacao_invalida"]);
  assert.equal(f.aparelhos.length, 0);
});

test("id_instalacao ausente ou inválido: 422", async () => {
  const f = criarFalsos();
  assert.equal((await processarRegistro(requisicao({}), f.deps)).status, 422);
  assert.equal((await processarRegistro(requisicao({ id_instalacao: "curto" }), f.deps)).status, 422);
  assert.equal((await processarRegistro(requisicao({ id_instalacao: "../../etc/passwd/xxxx" }), f.deps)).status, 422);
  assert.equal(f.aparelhos.length, 0);
});

test("corpo que não é JSON: 400", async () => {
  const f = criarFalsos();
  assert.equal((await processarRegistro(requisicao("isto nao e json"), f.deps)).status, 400);
});

test("repetir o registro de um aparelho ainda pendente reemite o token (resposta perdida) sem duplicar", async () => {
  const f = criarFalsos();
  await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { token: "token-2", status: "pendente" });
  assert.equal(f.aparelhos.length, 1);
  assert.equal(f.aparelhos[0].chave_hash, sha256Hex("token-2"));
});

test("aparelho já liberado ou revogado não recebe token de novo: 409", async () => {
  const f = criarFalsos();
  await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  f.aparelhos[0].status = "ativo";
  assert.equal((await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps)).status, 409);
  f.aparelhos[0].status = "revogado";
  assert.equal((await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps)).status, 409);
});

test("muitos registros novos do mesmo IP: 429", async () => {
  const f = criarFalsos({ registrosDoIp: LIMITE_REGISTROS_NOVOS_POR_IP_HORA });
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }, CHAVE, { "x-forwarded-for": "203.0.113.9" }), f.deps);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "3600");
  assert.deepEqual(f.recusas, ["limite_registros_ip"]);
});

test("cadastro de pendentes cheio: 503 (o app tenta de novo depois)", async () => {
  const f = criarFalsos({ pendentesExtras: LIMITE_APARELHOS_PENDENTES });
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  assert.equal(r.status, 503);
  assert.deepEqual(f.recusas, ["cadastro_cheio"]);
  assert.equal(f.aparelhos.length, 0);
});

test("nome e modelo opcionais: sem eles o registro funciona", async () => {
  const f = criarFalsos();
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  assert.equal(r.status, 201);
  assert.equal(f.aparelhos[0].nome, null);
  assert.equal(f.aparelhos[0].modelo, null);
});

test("corpo grande demais: 413 antes de ler", async () => {
  const f = criarFalsos();
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }, CHAVE, { "content-length": "999999" }), f.deps);
  assert.equal(r.status, 413);
});

test("falha do banco: 503", async () => {
  const f = criarFalsos({ falhar: true });
  assert.equal((await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps)).status, 503);
});

test("status: o dono do token vê o próprio estado; token desconhecido é 401", async () => {
  const deps = {
    async buscarDispositivo(hash: string) {
      return hash === sha256Hex("meu-token") ? { id: "d1", nome: "x", status: "pendente" as StatusDispositivo } : null;
    },
  };
  const ok = await processarStatus(new Request("https://exemplo.test/s", { headers: { authorization: "Bearer meu-token" } }), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: "pendente" });
  const ruim = await processarStatus(new Request("https://exemplo.test/s", { headers: { authorization: "Bearer outro" } }), deps);
  assert.equal(ruim.status, 401);
  const sem = await processarStatus(new Request("https://exemplo.test/s"), deps);
  assert.equal(sem.status, 401);
});

test("sem IP legível o aparelho é gravado com ip_registro \"desconhecido\" (assim o limite por IP também o conta)", async () => {
  const f = criarFalsos();
  const r = await processarRegistro(requisicao({ id_instalacao: INSTALACAO }), f.deps);
  assert.equal(r.status, 201);
  assert.equal(f.aparelhos[0].ip_registro, "desconhecido");
});
