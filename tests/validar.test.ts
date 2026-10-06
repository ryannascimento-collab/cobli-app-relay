import { test } from "node:test";
import assert from "node:assert/strict";
import {
  converterCapturadoEm,
  converterDataRecebimento,
  ehJpeg,
  lerBearer,
  normalizarIdApp,
  normalizarNumeroNf,
  textoOpcional,
} from "../src/lib/capturas/validar";

test("numero_nf: só dígitos, sem zeros à esquerda", () => {
  assert.equal(normalizarNumeroNf("000123"), "123");
  assert.equal(normalizarNumeroNf(" 45 "), "45");
  assert.equal(normalizarNumeroNf("12a3"), null);
  assert.equal(normalizarNumeroNf(""), null);
  assert.equal(normalizarNumeroNf("000"), null);
  assert.equal(normalizarNumeroNf("1".repeat(21)), null);
  assert.equal(normalizarNumeroNf(null), null);
});

test("data_recebimento: dd/mm/aaaa e data real", () => {
  assert.equal(converterDataRecebimento("06/10/2026"), "2026-10-06");
  assert.equal(converterDataRecebimento("29/02/2028"), "2028-02-29");
  assert.equal(converterDataRecebimento("29/02/2027"), null);
  assert.equal(converterDataRecebimento("31/04/2026"), null);
  assert.equal(converterDataRecebimento("2026-10-06"), null);
  assert.equal(converterDataRecebimento("6/10/2026"), null);
  assert.equal(converterDataRecebimento(undefined), null);
});

test("id do app: restrito a letras, números, _ e -", () => {
  assert.equal(normalizarIdApp("1791322637072"), "1791322637072");
  assert.equal(normalizarIdApp("../etc"), null);
  assert.equal(normalizarIdApp("a b"), null);
  assert.equal(normalizarIdApp(""), null);
  assert.equal(normalizarIdApp("x".repeat(65)), null);
});

test("texto opcional nunca falha: vazio vira null e o excesso é cortado", () => {
  assert.equal(textoOpcional("", 10), null);
  assert.equal(textoOpcional("   ", 10), null);
  assert.equal(textoOpcional(null, 10), null);
  assert.equal(textoOpcional("  João   Silva ", 50), "João Silva");
  assert.equal(textoOpcional("abcdef", 3), "abc");
});

test("capturado_em: usa o enviado ou cai para o momento do recebimento", () => {
  const agora = new Date("2026-10-06T12:00:00Z");
  assert.equal(converterCapturadoEm("2026-10-05T10:30:00Z", agora), "2026-10-05T10:30:00.000Z");
  assert.equal(converterCapturadoEm("lixo", agora), "2026-10-06T12:00:00.000Z");
  assert.equal(converterCapturadoEm(null, agora), "2026-10-06T12:00:00.000Z");
});

test("JPEG é conferido pelos bytes", () => {
  assert.equal(ehJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(ehJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(ehJpeg(new Uint8Array([])), false);
});

test("Bearer", () => {
  assert.equal(lerBearer("Bearer abc123"), "abc123");
  assert.equal(lerBearer("bearer abc123"), "abc123");
  assert.equal(lerBearer("Basic abc"), null);
  assert.equal(lerBearer("Bearer"), null);
  assert.equal(lerBearer(null), null);
});
