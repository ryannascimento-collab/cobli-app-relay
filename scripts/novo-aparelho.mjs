// Gera o token de um aparelho novo e o SQL que o cadastra. Não acessa a internet nem precisa de chave.
// Uso:  node scripts/novo-aparelho.mjs "Celular do João"
// O token aparece UMA vez, aqui no terminal: copie e coloque no app daquele aparelho.
// O SQL guarda só o hash (SHA-256) do token; cole o SQL no SQL Editor do Supabase da nuvem.
import { createHash, randomBytes } from "node:crypto";

const nome = (process.argv[2] ?? "").trim();
if (nome.length < 2 || nome.length > 60) {
  console.error('Informe o nome do aparelho (2 a 60 caracteres). Ex.: node scripts/novo-aparelho.mjs "Celular do João"');
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const nomeSql = nome.replace(/'/g, "''");

console.log("\nTOKEN (mostrado só agora; vai no app, no cabeçalho Authorization: Bearer <token>):\n");
console.log(token);
console.log("\nSQL para colar no SQL Editor do Supabase (guarda só o hash):\n");
console.log(`insert into public.app_dispositivos (nome, chave_hash) values ('${nomeSql}', '${hash}');`);
console.log("\nPara REVOGAR este aparelho depois (o app dele para de funcionar na hora):\n");
console.log(`update public.app_dispositivos set ativo = false, revogado_em = now() where chave_hash = '${hash}';\n`);
