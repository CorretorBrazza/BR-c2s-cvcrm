# Instalação e uso

## 1. Pré-requisitos

- Node.js 20 ou superior (`node -v`).
- Chrome/Chromium **137+** (Ed25519 via WebCrypto para licenças offline).
- Uma conta ativa no C2S (`https://api.contact2sale.com`).

## 2. Build

```bash
npm install
npm run build:icons   # gera public/icons/icon-{16,32,48,128}.png
npm run build         # gera dist/
```

### O que este build contém (e falha se faltar)

O build lê o `.env` da raiz do projeto (copie de `.env.example`). Duas variáveis decidem se a
extensão pode agir:

| Variável | Efeito |
| --- | --- |
| `VITE_AUTOMATION_ENABLED` | `"true"` embute a automação no pacote; ausente/`"false"` gera um pacote que nunca age |
| `VITE_LICENSE_PUBLIC_KEY` | chave pública Ed25519 (raw base64 de 32 bytes, uma linha); sem ela **toda** licença é recusada |

Com automação ligada e chave ausente, o build **falha com exit 1** em vez de gerar um pacote inútil.
Depois de empacotar, o script confere que a chave e a marca `c2s:automation=on` realmente entraram
no `dist/background/serviceWorker.js`, e grava `dist/build-info.json`.

Para gerar o par de chaves e uma licença de teste:

```bash
node scripts/license.mjs keygen          # cria license-private.pem e license-public.pem
node scripts/license.mjs sign --customer "Cliente" --plan pro --days 365
```

A chave **privada** nunca vai para o build nem para o controle de versão.

O script de build roda seis builds Vite em sequência e valida os artefatos:

| Arquivo em `dist/` | Origem |
| --- | --- |
| `panel.html` + `assets/` | painel React |
| `background/serviceWorker.js` | service worker (MV3) |
| `content/index.js` | content script do C2S (ISOLATED) |
| `content/interceptor.js` | interceptor do C2S (MAIN world) |
| `content/cvcrm.js` | content script do CV CRM (ISOLATED) |
| `content/cvcrm-guard.js` | guard do `confirm` do CV CRM (MAIN world) |
| `manifest.json`, `offscreen.html`, `offscreen.js`, `icons/` | `public/` |

Se algum arquivo obrigatório faltar, o build falha em vez de gerar uma extensão quebrada.

## 3. Carregar no Chrome

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → selecione a pasta `dist/`.
4. Fixe o ícone da extensão na barra.

> Ao alterar o código, rode `npm run build` e clique em **Recarregar** no cartão da extensão.

## 4. Primeiro uso

1. Clique no ícone → o painel abre em uma aba dedicada.
2. Abra `https://api.contact2sale.com` e faça login.
3. Volte ao painel: o cartão **Conexão com o C2S** deve ficar verde em alguns segundos.
   O vínculo é feito por *heartbeat* do content script — não é necessário conceder permissão de abas.
4. Vá em **Inspeção** e confirme que o modo inspeção está ligado (padrão).
5. Navegue pelo C2S para gerar amostras (veja [`INSPECAO-CALIBRACAO.md`](INSPECAO-CALIBRACAO.md)).
6. Abra **Janelas** para acompanhar os prazos. Cada lead visto vira uma janela; o Bolsão pausa
   depois de uma captura até a interação ser comprovada. A automação só roda com build habilitado,
   opt-in, calibração, licença e inspeção desligada — veja [`F3-JANELAS.md`](F3-JANELAS.md).

## 5. Ativar o CV CRM (mover etapa)

O CV CRM é um módulo separado, com a mesma licença e o mesmo service worker.
Ele só move lead de **Aguardando Atendimento Corretor** (id `2`) para
**Em Atendimento** (id `4`), clicando o mesmo botão que o corretor clicaria.
Contrato completo em [`CVCRM.md`](CVCRM.md).

Ordem de ativação (não pule etapas):

1. Confirme a licença em **Licença** (`VALIDA` ou `TOLERANCIA_OFFLINE`).
2. Registre o opt-in da automação e desligue o **Modo inspeção**.
3. Abra o kanban do CRM (`https://<tenant>.cvcrm.com.br/corretor/comercial/andamentoleads`)
   numa aba e faça login.
4. Painel → **CV CRM** › **Mover etapa** → **Definir linha de base**. Todo lead
   que já está na coluna de entrada passa a ser ignorado; só os próximos serão
   movidos.
5. Ligue **Módulo CV CRM**. A seção “Automação não liberada” deve listar
   apenas “Mover etapa desligado”.
6. Com o corretor olhando o kanban, ligue **Mover etapa automaticamente**.
7. Espere o próximo lead real. O esperado: aba abre, ~5 s depois a etapa muda,
   a aba fecha, chega a notificação “CV CRM: etapa alterada”.

O módulo falha fechado: em qualquer dúvida (painel ambíguo, alvo bloqueado,
lead diferente do pedido, etapa sem confirmação em 25 s) ele **não** move, avisa
o corretor e não tenta aquele lead de novo.

## 6. Abrir no painel lateral

O painel é uma página normal (`panel.html`), aberta em aba pelo ícone da extensão. O botão
**Abrir painel lateral** na barra esquerda usa `chrome.sidePanel`. Os dois modos mostram os mesmos
dados; a aba costuma ser mais confortável para inspeção e exportação.

## 7. Configurar a licença

Em **Licença**, cole o conteúdo do arquivo `.lic` e clique em **Validar e salvar**. A verificação
acontece no navegador. Veja [`LICENCA.md`](LICENCA.md).

## 8. Atualizar

```bash
npm run build
```

Em `chrome://extensions`, clique em **Recarregar**. Os dados locais (IndexedDB/
`chrome.storage`) são preservados entre recarregamentos; `npm run clean` remove apenas `dist/`.

## 9. Desinstalar

Remova a extensão em `chrome://extensions`. Isso apaga o armazenamento local associado à extensão.
Para apagar os dados **sem** desinstalar, use **Configurações → Apagar todos os dados**.

## Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| Painel diz “Abra o painel como extensão do Chrome” | página aberta fora do contexto da extensão | abra pelo ícone da extensão |
| Status fica “Aguardando” | aba do C2S fechada, fora do domínio ou sem login | abra/reautentique a aba do C2S |
| Screenshot falha | a aba do C2S não é a aba ativa da janela | deixe o C2S em foco e tente de novo |
| Captura do Bolsão bloqueada | a aba do C2S não está em `/webapp/bucket_leads` | abra a página do Bolsão na aba do C2S |
| Lead normal detectado mas sem ação | contrato de atividade não calibrado | comportamento esperado; falta amostra manual do modal/POST |
| Licença “requer Chrome 137+” | WebCrypto sem Ed25519 | atualize o Chrome |
| Automação nunca age | build sem `VITE_AUTOMATION_ENABLED=true` ou sem chave pública | veja **Diagnóstico → Automação/Chave de licença no build** e refaça o build |
| Bolsão “cheio” mas nenhum lead lido | layout do C2S mudou | veja `SELETOR_SUSPEITO` nos Logs e rode **Diagnóstico → Auditar aba do C2S** |
| CV CRM: “Linha de base não definida” | módulo ligado sem baseline | abra o kanban e clique **Definir linha de base** |
| CV CRM: “O kanban do CV CRM não respondeu” | a aba do kanban está fora do domínio, sem login ou foi recarregada antes do content script | recarregue a aba e repita |
| CV CRM: lead fica em `BLOQUEADO` | `SEM_FORM`, `WORKFLOW_AMBIGUO` ou `ALVO_INDISPONIVEL` | layout/permissão mudou no CRM; veja [`CVCRM.md`](CVCRM.md) §9 |
| CV CRM: `SEM_CONFIRMACAO_DE_ETAPA` | a página não recarregou com a etapa 4 ativa em 25 s | verifique manualmente no CRM; o lead não é retentado |
| Build falha em `typecheck` | alteração com erro de tipo | rode `npm run typecheck` e corrija |
