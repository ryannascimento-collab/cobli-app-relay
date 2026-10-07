// Gera a "chave de implantação" que vai DENTRO do APK (o app a envia em X-Chave-Implantacao ao se registrar).
// Ela só impede que robôs da internet lotem o cadastro de aparelhos; quem tem o APK a extrai. Por isso é
// revogável: se vazar, gere outra, solte um APK novo e revogue a antiga. Aparelhos já liberados continuam
// funcionando (cada um tem o seu token).
// Uso:  node scripts/nova-chave-implantacao.mjs "APK transportadora 1"
// A chave aparece UMA vez, aqui. O SQL guarda só o hash; cole-o no SQL Editor do Supabase da nuvem.
import { createHash, randomBytes } from "node:crypto";

const rotulo = (process.argv[2] ?? "").trim();
if (rotulo.length < 2 || rotulo.length > 60) {
  console.error('Informe um rótulo (2 a 60 caracteres). Ex.: node scripts/nova-chave-implantacao.mjs "APK transportadora 1"');
  process.exit(1);
}

const chave = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(chave).digest("hex");
const rotuloSql = rotulo.replace(/'/g, "''");

console.log("\nCHAVE DE IMPLANTAÇÃO (mostrada só agora; vai dentro do APK, cabeçalho X-Chave-Implantacao):\n");
console.log(chave);
console.log("\nSQL para colar no SQL Editor do Supabase (guarda só o hash):\n");
console.log(`insert into public.app_chaves_implantacao (rotulo, chave_hash) values ('${rotuloSql}', '${hash}');`);
console.log("\nPara REVOGAR esta chave depois (novos registros com ela passam a ser recusados; os aparelhos já liberados seguem):\n");
console.log(`update public.app_chaves_implantacao set ativa = false, revogada_em = now() where chave_hash = '${hash}';\n`);
