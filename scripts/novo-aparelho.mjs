// Cadastra à mão um aparelho JÁ LIBERADO (para testes ou casos especiais). No uso normal o app se registra
// sozinho (POST /api/app/v1/registrar) e você só libera o aparelho pendente — ver README.
// Uso:  node scripts/novo-aparelho.mjs "Celular de teste"
// O token aparece UMA vez, aqui no terminal. O SQL guarda só o hash; cole-o no SQL Editor do Supabase da nuvem.
import { createHash, randomBytes } from "node:crypto";

const nome = (process.argv[2] ?? "").trim();
if (nome.length < 2 || nome.length > 60) {
  console.error('Informe o nome do aparelho (2 a 60 caracteres). Ex.: node scripts/novo-aparelho.mjs "Celular de teste"');
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const nomeSql = nome.replace(/'/g, "''");

console.log("\nTOKEN (mostrado só agora; vai no app, no cabeçalho Authorization: Bearer <token>):\n");
console.log(token);
console.log("\nSQL para colar no SQL Editor do Supabase (guarda só o hash; o aparelho já nasce liberado):\n");
console.log(`insert into public.app_dispositivos (nome, chave_hash, status, liberado_em) values ('${nomeSql}', '${hash}', 'ativo', now());`);
console.log("\nPara REVOGAR este aparelho depois (o app dele para de funcionar na hora):\n");
console.log(`update public.app_dispositivos set status = 'revogado', revogado_em = now() where chave_hash = '${hash}';\n`);
