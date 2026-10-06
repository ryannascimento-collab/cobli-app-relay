# Cobli App Relay

Relay público entre o **aplicativo Android** e o **Cobli Operações**. Roda na Vercel.

O servidor do Cobli Operações fica na rede da Produção, sem endereço público. Os celulares ficam na rua. Este projeto é o endereço que os celulares alcançam: ele recebe a captura (foto + dados), valida e guarda numa área temporária na nuvem. O servidor da Produção **busca** de lá (só conexões de saída) e grava na quarentena local.

```
celular (APK) --HTTPS--> este relay (Vercel) --> armazenamento na nuvem <--busca-- servidor da Produção
```

## Estado

**Esqueleto.** Só existe `GET /api/app/v1/saude`. A rota `POST /api/app/v1/capturas` e a ligação com o armazenamento ainda não foram implementadas: dependem da definição do funcionamento do app. O contrato proposto está em `specs/api-app-android.md` do repositório `cobli-operacoes`.

## Regras de segurança (valem para todo código novo aqui)

- **Chave por aparelho** no cabeçalho `X-Device-Key`. Só o hash SHA-256 é guardado. Nunca uma chave única dentro do APK.
- **Sem rotas de leitura.** O app só envia; ninguém lista nem baixa fotos por esta API.
- **Credencial mínima** no armazenamento: gravar capturas e consultar aparelhos.
- **Nenhuma chave do Supabase da Produção** neste projeto. Só as do projeto Supabase da nuvem, e só na Vercel.
- Limites por aparelho guardados no banco (funções da Vercel não guardam estado entre chamadas).
- Nunca registrar em log a chave recebida, o conteúdo da foto ou dados pessoais.
- Segredos só em variáveis de ambiente da Vercel. `.env*` está no `.gitignore`.

## Rodar localmente

```
npm install
npm run dev
```

Teste: `http://localhost:3000/api/app/v1/saude` deve responder `{"ok":true,"versao":1}`.

## Publicar

Importe este repositório na Vercel (**Add New → Project**). Framework: Next.js (detectado). Cada push na `main` publica. As variáveis de `.env.example` são cadastradas em **Settings → Environment Variables**.
