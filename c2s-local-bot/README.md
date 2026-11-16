# C2S Local Bot

Extensão Chrome (Manifest V3) para **monitorar, inspecionar e organizar leads no C2S** com dados
100% locais. Construída em React 18 + Vite 5 + Tailwind 3 + TypeScript.

> **Estado desta entrega (F1 + F2 + F3):** estrutura, build, painel, interceptação de rede, captura
> de amostras para calibração **e o motor de janelas de interação**. A F3 detecta leads do Bolsão e
> da lista normal, cria prazos por lead, protege uma captura por vez e pausa o Bolsão até a
> interação ser comprovada. **A automação nasce desligada** (`VITE_AUTOMATION_ENABLED=false`) e,
> mesmo ligada, exige opt-in, calibração, licença e guard. A escrita em lead normal continua
> bloqueada até o contrato de atividade ser calibrado.

## Requisitos

- Node.js **>= 20**
- Chrome/Chromium **>= 116** (recomendado 137+ para validação de licença Ed25519 nativa)

## Instalação rápida

```bash
npm install
npm run build:icons
npm run build
```

Depois, em `chrome://extensions`:

1. Ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `dist/`.
3. Clique no ícone da extensão para abrir o painel.
4. Abra `https://api.contact2sale.com` em outra aba e faça login.

Detalhes em [`docs/INSTALACAO.md`](docs/INSTALACAO.md).

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run build` | Build completo (painel, service worker, content script, interceptor) e valida `dist/` |
| `npm run build:icons` | Gera os 4 ícones PNG em `public/icons` |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Testes unitários (Vitest + jsdom) |
| `npm run pack` | Empacota `dist/` em `.zip` para distribuição |
| `npm run clean` | Remove `dist/` |

## O que já funciona

- Painel completo (Dashboard, Janelas, Leads, Logs, Métricas, Templates, Inspeção, Configurações,
  Licença, Diagnóstico) em aba dedicada e/ou painel lateral.
- Detecção de contexto da página do C2S (lista, Bolsão, detalhe do lead, login).
- **Janelas de interação (F3)**: todo lead visto — do Bolsão ou da lista normal — ganha prazo,
  estado e histórico. Regra do pool: **1 captura → protege → alerta → pausa** até interação
  comprovada. Clique em WhatsApp nunca conta como interação; a prova é `POST
  /webapp/leads/super_reply` 2xx ou confirmação manual no painel.
- **Modo inspeção**: grava URL, método, payload, resposta, headers sanitizados, HTML, seletores,
  screenshot e tempo de cada chamada relevante.
- Ponte segura entre `MAIN` world (interceptor de `fetch`/XHR) e `ISOLATED` (content script) com
  nonce, validação de origem e limite de eventos. A ponte fica ligada continuamente para detectar
  `super_reply`; a gravação de amostras só ocorre na inspeção.
- Exportação/importação de **bundle de calibração** (JSON) e confirmação de calibração.
- **Contrato detectado** a partir das amostras reais: lista do Bolsão (rede **ou** DOM), captura
  (rede **ou** script `takeLeadToMe`), CSRF, gate de interação, sinais de sucesso/falha e seletores
  críticos, com confiança, evidência e origem por campo. O `POST` fica marcado como **"a confirmar"**
  até a primeira captura real — isso não bloqueia a calibração.
- **CV CRM — mover etapa**: com o kanban do CV CRM aberto, leva o lead de
  **Aguardando Atendimento Corretor** (id 2) para **Em Atendimento** (id 4) clicando o
  `<a>` nativo do CRM (nada de POST forjado). Só leads novos, só essa etapa, com
  linha de base, atraso de 5 s, corte de 2 h e pós-check pela própria página.
  Contrato em [`docs/CVCRM.md`](docs/CVCRM.md).
- **Painel com dois produtos**: a navegação trata **C2S** (Bolsão, leads, janelas) e **CV CRM**
  (mover etapa) com o mesmo peso — “Visão geral” mostra os dois lado a lado, cada um com a sua seção,
  e o rodapé exibe o estado de ambos. Licença, inspeção e logs ficam em “Sistema”.
- Licença offline Ed25519 (arquivo `.lic` colado no painel), sem servidor e sem `?key=`.
- Retenção automática: logs 30d, leads 90d, métricas 12m, screenshots 7d (máx. 200).
- Notificações locais e alerta sonoro via documento `offscreen`.

## O que NÃO faz (ainda)

- **Não captura leads automaticamente no build de fábrica**: `VITE_AUTOMATION_ENABLED=false`. Com
  build habilitado, a captura do Bolsão ainda exige opt-in, calibração confirmada, licença válida,
  robô ativo, modo inspeção desligado e aba na página do Bolsão.
- **Não cria atividade em lead normal**: o contrato do modal/POST nunca foi observado; o executor
  recusa com `CONTRATO_NAO_CALIBRADO`. Leads normais são detectados e alertados, mas a escrita fica
  bloqueada.
- Não move leads no funil do **C2S**. No CV CRM o único movimento possível é 2 → 4 (ver
  [`docs/CVCRM.md`](docs/CVCRM.md)); nada é arquivado, descartado ou excluído em nenhum dos dois.
- Não envia mensagens (nem por `wa.me`).
- Não navega sozinha até a página do Bolsão; se a aba não estiver lá, a captura do pool é bloqueada
  com aviso.
- Não promete captura com aba fechada, Chrome fechado, máquina suspensa ou aba congelada/descartada
  pelo Chrome. O texto honesto é: **detecta e age em segundos enquanto o C2S estiver aberto e ativo
  no Chrome**.
- Não armazena senha nem cookie do C2S.
- Não envia dados para servidor por padrão (telemetria desligada).

Lista completa em [`docs/LIMITACOES.md`](docs/LIMITACOES.md). Detalhes do motor em
[`docs/F3-JANELAS.md`](docs/F3-JANELAS.md).

## Documentação

- [Instalação e uso](docs/INSTALACAO.md)
- [Arquitetura](docs/ARQUITETURA.md)
- [Janelas de interação (F3)](docs/F3-JANELAS.md)
- [CV CRM — mover etapa](docs/CVCRM.md)
- [Inspeção e calibração](docs/INSPECAO-CALIBRACAO.md)
- [Privacidade e segurança](docs/PRIVACIDADE.md)
- [Licenciamento](docs/LICENCA.md)
- [Limitações conhecidas](docs/LIMITACOES.md)

## Aviso

Esta extensão usa endpoints internos do C2S. Ela **não é oficial** e pode parar de funcionar se o
C2S mudar layout ou API. Use apenas na sua própria conta, respeitando os termos do serviço.
