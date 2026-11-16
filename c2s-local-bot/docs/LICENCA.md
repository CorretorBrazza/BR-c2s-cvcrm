# Licenciamento

## Modelo

Licença **offline**, assinada com **Ed25519**. O arquivo `.lic` é colado no painel e verificado no
próprio navegador com a chave pública compilada no build. Não existe servidor, não existe
`GET ?key=` e nenhuma chave sai do seu computador.

## Formato do arquivo `.lic`

JSON com três campos:

```json
{
  "payload": "<base64url do JSON de licença>",
  "signature": "<base64url da assinatura Ed25519 (64 bytes)>",
  "alg": "Ed25519"
}
```

O `payload` decodifica para:

```json
{
  "customer": "Imobiliária Exemplo",
  "plan": "pro",
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "licenseId": "lic-0001",
  "features": {
    "bucketCapture": true,
    "autoStatus": true,
    "autoActivity": true,
    "autoMessage": false,
    "metrics": true
  }
}
```

Regras aplicadas na validação:

- `plan` ∈ `trial | pro | enterprise`
- `features` é convertido por allowlist (só `true` literal libera)
- a assinatura cobre os **bytes ASCII do texto `payload`** (a string base64url), não o JSON
  decodificado
- `expiresAt` vencido gera `EXPIRADA`; dentro de `offlineLicenseToleranceHours` vira
  `TOLERANCIA_OFFLINE`
- sem chave configurada no build → `INVALIDA` com motivo explícito

Status possíveis: `NAO_CONFIGURADA`, `VALIDA`, `TOLERANCIA_OFFLINE`, `EXPIRADA`, `INVALIDA`.

## Chave pública no build

A chave pública vem de `VITE_LICENSE_PUBLIC_KEY` (veja `.env.example`). Formatos aceitos:

- PEM SPKI (`-----BEGIN PUBLIC KEY-----`)
- base64 de 32 bytes crus (chave Ed25519)

```bash
# .env
VITE_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----"
```

> A chave **privada** nunca entra no build nem no repositório.

## Gerar chaves e assinar

O repositório inclui `scripts/license.mjs`:

```bash
# 1) gera o par de chaves (não versione os arquivos gerados)
node scripts/license.mjs keygen

# 2) assina uma licença
node scripts/license.mjs sign \
  --customer "Imobiliária Exemplo" \
  --plan pro \
  --days 365 \
  --features bucketCapture,autoStatus,autoActivity,metrics

# 3) confere o arquivo gerado (opcional, mas recomendado)
node scripts/license.mjs verify --license c2s-license.lic
```

Saídas:

- `license-public.pem` — use o conteúdo (ou a base64 raw impressa) em `VITE_LICENSE_PUBLIC_KEY`
- `license-private.pem` — guarde em cofre; é ela que assina
- `c2s-license.lic` — entregue ao cliente

O script recusa sobrescrever chaves existentes sem `--force`.

## Ativar no painel

1. Abra **Licença**.
2. Cole o conteúdo completo do `.lic`.
3. **Validar e salvar**.
4. Confira status, cliente, plano, validade e recursos liberados.

## Compatibilidade

A verificação usa **WebCrypto Ed25519**, disponível a partir do **Chrome 137**. Em versões
anteriores o status fica `INVALIDA` com o motivo “requer Chrome 137+”. Nesta entrega
(`FEATURE_FLAGS.licenseEnforced = false`) isso não bloqueia o uso da inspeção.

## Relação com a calibração

Licença válida **não** liga automação sozinha. A ordem de liberação é:

1. licença válida;
2. calibração confirmada;
3. `FEATURE_FLAGS.automationEnabled = true` no build;
4. opção específica ligada pelo corretor;
5. robô ativo e não pausado.

## Segurança

- Assinatura Ed25519: alterar um byte do payload invalida a licença.
- A chave privada deve ficar offline. Se vazar, gere um novo par e uma nova build.
- Não há revogação online na v1: licenças curtas + renovação por novo `.lic` são a mitigation.
