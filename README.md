# Cobli App Relay

Relay público entre o **aplicativo Android** e o **Cobli Operações**. Roda na Vercel.

O servidor do Cobli Operações fica na rede da Produção, sem endereço público. Os celulares ficam na rua. Este projeto é o endereço que os celulares alcançam: ele recebe a captura (foto + dados), valida e guarda numa área temporária na nuvem. O servidor da Produção **busca** de lá (só conexões de saída) e grava na quarentena local.

```
celular (APK) --HTTPS--> este relay (Vercel) --> armazenamento na nuvem <--busca-- servidor da Produção
```

## Estado

Rotas:

- `GET /api/app/v1/saude` — sem autenticação; `{"ok":true,"versao":1}`.
- `POST /api/app/v1/registrar` — o app se registra sozinho na primeira abertura (JSON `{ id_instalacao, nome?, modelo? }`, cabeçalho `X-Chave-Implantacao`). Devolve o token do aparelho uma única vez; o aparelho nasce **pendente** e só envia depois de **liberado por um admin**. Respostas: 201, 200 (reemissão enquanto pendente), 401, 409, 422, 429, 503.
- `GET /api/app/v1/status` — com o token do aparelho; devolve `{ "status": "pendente" | "ativo" | "revogado" }`.
- `POST /api/app/v1/capturas` — recebe o canhoto de NF-e do aplicativo (multipart: `id`, `numero_nf`, `data_recebimento` dd/mm/aaaa, `nome_recebedor`, `usuario`, `capturado_em`, `foto` JPEG até 4 MB). Autentica por `Authorization: Bearer <token do aparelho>` e é idempotente por `(aparelho, id)`. Respostas: 201 (novo), 200 (reenvio já salvo), 401, 413, 415, 422 (só `numero_nf`, `data_recebimento`, `id` ou `foto` inválidos), 429, 503. **A URL é exatamente `https://cobli-app-relay.vercel.app/api/app/v1/capturas`, sem barra no final** (com barra a Vercel responde 308, e o app trata como falha).

O contrato completo e as decisões estão em `specs/api-app-android.md` do repositório `cobli-operacoes`. O relay não tem nenhuma rota de leitura: consultar e ver as fotos é feito no Cobli Operações.

## Preparar o Supabase da nuvem

No SQL Editor, rode em ordem: `supabase/01_estrutura.sql`, `02_canhotos.sql` e `03_registro_automatico.sql`. Todos são idempotentes.

## Registro e liberação de aparelhos

1. **Chave de implantação** (vai dentro do APK; só impede que robôs lotem o cadastro, e é revogável): `node scripts/nova-chave-implantacao.mjs "APK transportadora 1"` imprime a chave (uma vez) e o SQL com o hash.
2. O app se registra sozinho (`/registrar`) e o aparelho fica **pendente**.
3. Um **admin libera** o aparelho: pela tela do Cobli Operações (planejada) ou, até lá, por SQL: `select id, nome, modelo, criado_em, ip_registro from public.app_dispositivos where status = 'pendente' order by criado_em;` e depois `update public.app_dispositivos set status = 'ativo', liberado_em = now() where id = '<id>';`. Revogar: `update public.app_dispositivos set status = 'revogado', revogado_em = now() where id = '<id>';`.
4. Para um aparelho de teste já liberado, sem passar pelo registro: `node scripts/novo-aparelho.mjs "Celular de teste"`.

Um token por aparelho: nunca um token único no APK.

## Testes

```
npm test
```

Cobre envio normal, reenvio duplicado, campos obrigatórios ausentes, foto inválida ou grande, token errado, limite de envios e falha do banco (com um banco falso em memória).

## Regras de segurança (valem para todo código novo aqui)

- **Token por aparelho** no cabeçalho `Authorization: Bearer`. Só o hash SHA-256 é guardado. Nunca um token único dentro do APK.
- **Sem rotas de leitura.** O app só envia; ninguém lista nem baixa fotos por esta API.
- **Credencial mínima** no armazenamento: gravar capturas e consultar aparelhos.
- **Nenhuma chave do Supabase da Produção** neste projeto. Só as do projeto Supabase da nuvem, e só na Vercel.
- Limites por aparelho guardados no banco (funções da Vercel não guardam estado entre chamadas).
- Nunca registrar em log o token recebido, o conteúdo da foto nem os campos do canhoto. Não guardar CPF/RG (o app não os envia).
- Segredos só em variáveis de ambiente da Vercel. `.env*` está no `.gitignore`.

## Rodar localmente

```
npm install
npm run dev
```

Teste: `http://localhost:3000/api/app/v1/saude` deve responder `{"ok":true,"versao":1}`.

## Publicar

Importe este repositório na Vercel (**Add New → Project**). Framework: Next.js (detectado). Cada push na `main` publica. As variáveis de `.env.example` são cadastradas em **Settings → Environment Variables**.
