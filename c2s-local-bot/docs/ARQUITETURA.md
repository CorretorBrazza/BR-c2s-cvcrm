# Arquitetura

## Visão geral

```
┌───────────────────────────── C2S (api.contact2sale.com) ─────────────────────────────┐
│  MAIN world                        │  ISOLATED world                                 │
│  content/interceptor.js            │  content/index.js                               │
│  - hook de fetch/XHR               │  - parsers (lista, Bolsão, detalhe)             │
│  - handshake com nonce             │  - detecção de contexto + heartbeat             │
│  - envia request/response          │  - gravação de DOM/seletores                    │
└───────────────┬────────────────────┴──────────────────┬──────────────────────────────┘
                │ window.postMessage (nonce)             │ chrome.runtime.sendMessage
                ▼                                        ▼
        ┌────────────────────────── Service Worker (MV3) ──────────────────────────┐
        │ messageRouter → windowEngine / inspection / session / license / metrics  │
        │ storage: IndexedDB (dados) + chrome.storage (config/sessão/fila)         │
        │ alarms: watchdog 30s · janelas 30s · retenção 24h · licença 6h          │
        └───────────────────────────────┬──────────────────────────────────────────┘
                                        │ broadcasts (event/status/inspection)
                                        ▼
                              painel React (panel.html)
```

## Camadas

### `src/shared/`
Tipos, constantes (endpoints, seletores, limites, status), utilitários (telefone, data, validação,
hash) e o protocolo da ponte. Nada aqui conhece `chrome.*` nem React.

`analysis/` é puro e testável: `calibrationCounts` aplica as regras de evidência,
`contractAnalyzer` infere o contrato de captura (endpoints, payload, CSRF, gate e seletores) sem
inventar dados, `windowPolicy` decide prazos/fila/pausa do Bolsão e `interactionDetector` reconhece
a única prova automática de interação (`super_reply` 2xx com `success:true`). Quando não há amostra
de rede, a lista sai do DOM (`.bucket-lead-card`) e o `POST` sai do script `takeLeadToMe` da página,
marcado como **"a confirmar"** até a primeira captura real.

### `src/content/`
- `injected/interceptor.ts` roda em **MAIN world**: substitui `window.fetch`, `XMLHttpRequest.open/
  send/setRequestHeader` apenas para **observar**. Não altera respostas, não bloqueia e não executa
  código remoto.
- `bridge/bridgeClient.ts` roda em **ISOLATED**: valida `event.source`, `event.origin`, formato do
  envelope, nonce e rate limit antes de aceitar qualquer evento.
- `parsers/` extrai dados de página com múltiplos seletores de fallback; `leadParser` prioriza o
  JSON `#lead-user-data[data-lead]`.
- `inspection/` grava rede, DOM e perfis de seletor.
- `actions/windowProbe.ts` lê o Bolsão e a lista normal sem clicar; `contactsParser.ts` extrai os
  leads da lista. `captureExecutor.ts` executa a captura **click-first** (clica no card, confirma
  uma única vez, confere a URL/destino) e `activityExecutor.ts` recusa até o contrato de atividade
  ser calibrado.
- `actions/actionGuard.ts` reexporta o portão puro de `shared/analysis/actionGuard.ts`.

### `src/background/`
- `serviceWorker.ts`: registro de listeners (`onInstalled`, `onStartup`, `action.onClicked`,
  `alarms.onAlarm`, `runtime.onMessage`) e abertura do painel.
- `messaging/messageRouter.ts`: trata todas as mensagens do painel e do content script.
- `automation/windowEngine.ts`: motor das janelas — tick de 30 s, detecção, fila, captura,
  atividade e confirmação de interação. `automationGate.ts` liga configuração/licença ao guard puro.
- `inspection/inspectionService.ts`: normaliza, classifica, mascara, persiste e exporta amostras.
- `session/sessionService.ts`: mantém o estado “aba do C2S aberta + heartbeat recente”.
- `license/licenseService.ts`: valida licença Ed25519 offline.
- `storage/`: IndexedDB com migrações versionadas e repositórios por entidade (inclui
  `lead_windows`).
- `queue/actionQueue.ts`: outbox persistente em `chrome.storage`, com backoff exponencial.
- `retention/retentionService.ts`: aplica as políticas de retenção.
- `security/`: mascaramento de PII e detecção de dados sensíveis.

### `src/panel/`
React com roteamento por hash (sem dependência de router). Cada rota consulta o service worker via
`panel:query` e assina broadcasts em tempo real (`useLiveEvents`). Não há `fetch` externo no painel.

## Modelo de mensagens

Contrato em `src/shared/types/messages.ts`:

- **Painel → SW**: `panel:query`, `settings:update`, `bot:toggle`, `inspection:*`,
  `calibration:*`, `template:*`, `windows:tick`, `windows:interaction`, `windows:clear`, `data:clear`.
- **Content → SW**: `page:context`, `page:heartbeat`, `insp:network`, `insp:dom`, `insp:selectors`,
  `insp:screenshot`, `windows:signal`, `log:event`.
- **SW → content**: `content:mode`, `content:capture-dom`, `content:profile-selectors`,
  `window:probe`, `window:capture`, `window:activity`.
- **SW → painel (broadcast)**: `LiveMessage` com `type: event | status | inspection`.

Toda resposta tem o formato `{ ok: true, data }` ou `{ ok: false, error }`.

## Armazenamento

| Onde | O quê | Por quê |
| --- | --- | --- |
| IndexedDB `c2s_local_bot` | leads, ações, logs, métricas, templates, amostras, calibração, janelas | volume e consultas |
| `chrome.storage.local` | configurações, sessão, estado da licença, fila de ações, baseline da lista normal | leitura rápida no boot |

Migrações em `storage/migrations.ts` criam os object stores e índices por versão. O código abre o
banco com `onupgradeneeded` idempotente.

## Detecção de página e sessão

1. O content script classifica a página por **URL + evidências de DOM** (não só URL).
2. A cada `heartbeatIntervalMs` envia `page:heartbeat`; o SW registra o `tabId` recebido do
   `sender` e atualiza a sessão.
3. “Conectado” = aba do C2S aberta **e** heartbeat dentro de `heartbeatStaleMs`.
4. Sem permissão `tabs`, o `tabId` é aprendido pelo heartbeat. Consequência: screenshots só
   funcionam com a aba do C2S ativa na janela.

## Inspeção

Fluxo: interceptor → ponte validada → `NetworkRecorder` (pareia request/response por método+URL,
janela de 120 s, buffer de 25) → `insp:network` → `inspectionService.normalizeNetwork` →
classificação do endpoint → mascaramento opcional → IndexedDB.

DOM e seletores são amostrados no carregamento, em mudança de contexto e sob demanda no painel.
Screenshots usam `chrome.tabs.captureVisibleTab` e passam pela mesma retenção.

## Automação e janelas

O motor de janelas roda a cada 30 s (`c2s:windows`) e também quando o content script sinaliza mudança
de DOM. Cada lead visto vira uma `LeadWindow` com prazo. A captura do Bolsão é **click-first**: o
executor clica no card e no confirmar da própria página, sem reproduzir o POST por conta própria.
Depois de uma captura, o pool fica pausado até existir evidência de interação — `super_reply` 2xx ou
confirmação manual —, nunca clique em WhatsApp.

`FEATURE_FLAGS.automationEnabled` nasce `false` (`VITE_AUTOMATION_ENABLED`). Mesmo que fosse `true`,
`evaluateAction` exige, nesta ordem:

1. operação não proibida;
2. build com automação;
3. opt-in explícito do corretor;
4. modo inspeção desligado;
5. calibração confirmada;
6. robô ativo e não pausado;
7. opção específica ligada nas configurações;
8. recurso presente na licença.

A criação de atividade em lead normal tem uma trava extra:
`FEATURE_FLAGS.activityAutomationEnabled = false` e um executor que recusa com
`CONTRATO_NAO_CALIBRADO`. Falta uma amostra real do modal/POST do C2S para escrever isso sem
inventar endpoint.

Detalhes operacionais e limites de execução em [`F3-JANELAS.md`](F3-JANELAS.md).

## Build

Quatro builds Vite independentes (`vite.config.ts`, `vite.background.config.ts`,
`vite.content.config.ts` + entrada MAIN) geram nomes fixos exigidos pelo manifest. O painel usa
`base: './'` para funcionar em `chrome-extension://`.

## Decisões relevantes

- **MAIN world separado** porque o C2S usa `fetch` da própria página; um content script isolado não
  veria as chamadas.
- **Nonce no handshake** porque qualquer script da página pode postar mensagens; sem nonce, a ponte
  seria um canal forjável.
- **Confirmação pós-navegação** porque a captura do Bolsão redireciona e o content script é
  destruído; a confirmação precisa vir do DOM da página de destino (ou da URL relida pelo SW).
- **Fila persistente** porque o service worker MV3 pode morrer no meio de uma ação.
- **Alarmes ≥ 30 s** porque o Chrome limita `periodInMinutes` a 0,5. Esse é o piso real do tick das
  janelas.
- **Pausa do Bolsão derivada do estado** (e não de um botão) para sobreviver a reinícios do service
  worker: uma captura sem interação comprovada mantém o pool parado.
- **Click-first** porque o POST do C2S usa CSRF e é feito pela própria página; reproduzir a chamada
  exigiria inventar headers/corpo.
