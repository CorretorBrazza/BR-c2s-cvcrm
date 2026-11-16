# Limitações conhecidas

Esta entrega cobre **F1 (estrutura, build, manifest, ícones, painel)**, **F2 (inspeção,
interceptação, gravação de rede/DOM/screenshot e bundle de calibração)** e **F3 (janelas de
interação por lead)**. A automação existe atrás de flags, mas nasce desligada e com uma parte
deliberadamente bloqueada.

## Automação desligada por padrão

- `FEATURE_FLAGS.automationEnabled` é `false` no build de fábrica
  (`VITE_AUTOMATION_ENABLED=false`); `evaluateAction` nega por padrão.
- Com build habilitado, a captura do Bolsão ainda exige opt-in, calibração confirmada, licença
  válida, robô ativo, modo inspeção desligado, opção `autoClaimPool` ligada e aba na página do
  Bolsão.
- **Criação de atividade em lead normal**: bloqueada por
  `FEATURE_FLAGS.activityAutomationEnabled = false` **e** pelo executor, que recusa com
  `CONTRATO_NAO_CALIBRADO` até existir amostra real do modal/POST.
- Movimentação de funil, alteração de status e envio de mensagem continuam sem executor liberado.
- Nenhuma ação arquiva, fecha negócio, exclui ou redistribui leads, em nenhuma configuração.

## Dependências de calibração

- O endpoint de **lista do Bolsão** (`GET /webapp/bucket_leads`) é inferido; quando não há amostra de
  rede, a lista sai do DOM (`.bucket-lead-card`). O histórico (`.bucket-at-card`) nunca é contado.
- Os **seletores** de card, nome, telefone e imóvel são candidatos com fallback até validação com
  amostras reais.
- O `POST /bucket_leads/{id}` fica **"a confirmar"** até a primeira captura real. A captura por
  clique não depende disso: quem envia o POST é a própria página.
- O **contrato de atividade** (modal `GET /webapp/leads/<id>/activity?action_modal=create_activity` e
  POST do formulário) nunca foi observado. Sem uma amostra manual, não há escrita em lead normal.
- O comportamento do `POST /bucket_leads/{id}` em **free tier** (`redirect_to_upselling`) e em falha
  (`#modal_bucket_lead_denied`) precisa ser reproduzido em conta de teste.

## Regra do Bolsão e prova de interação

O desenho é: capturar **1** lead → proteger → alertar → **pausar** o pool até interação comprovada.
Não há promessa de captura serial/contínua.

A prova automática de interação é `POST /webapp/leads/super_reply` com status 2xx e
`{ "success": true }`. Também é aceita a confirmação manual no painel. **Clique em WhatsApp nunca
conta**.

Se a aba não estiver na página do Bolsão, a captura do pool é bloqueada com aviso; a extensão não
navega sozinha para `/webapp/bucket_leads`.

## Limites reais de execução

A frase de produto acordada é:

> “Detecta e age em segundos enquanto o C2S estiver aberto e ativo no Chrome.”

Na prática:

- **Detecção** é de segundos quando a aba está executando (sinal de DOM em até ~2 s; tick de
  segurança a cada 30 s).
- **Ação** depende do Chrome manter a aba executável. Aba em segundo plano sofre estrangulamento de
  timers; depois de alguns minutos oculta pode ser **congelada** e, sob pressão de memória,
  **descartada**. Nesses casos o clique não roda até a aba voltar.
- **Máquina suspensa/hibernada**: nada roda; os alarmes disparam atrasados ao acordar. O motor
  registra `SUSPENSION_DETECTED` quando o intervalo passa de 2 min e revalida a página antes de agir.
- Mitigações: relógio no service worker (`chrome.alarms`), `autoDiscardable: false` na aba do C2S,
  opção de trazer a aba para frente ao agir (padrão ligada) e nenhuma espera por
  `requestAnimationFrame`.
- **Não** há promessa de captura com aba/Chrome fechado, máquina dormindo ou aba congelada.

## Lista normal (heurístico conservador)

- A primeira leitura da lista é baseline: nenhum lead antigo vira janela.
- Só ids que aparecem **acima** do primeiro id conhecido contam como novos; linhas carregadas por
  scroll atualizam o baseline sem criar janela.
- Se o C2S mudar a ordenação da lista, o heurístico pode deixar de criar uma janela (falso negativo)
  em vez de criar janelas falsas. O baseline pode ser zerado em **Janelas → Apagar tudo**.

## Screenshots

- `chrome.tabs.captureVisibleTab` só captura a **aba ativa** da janela.
- A opção “trazer a aba do C2S para frente ao agir” ativa a aba no momento da ação automática, não
  para screenshots de inspeção.
- Solução para inspeção: deixe a aba do C2S em foco na janela ao solicitar screenshot.
- Retenção: 7 dias / 200 arquivos (configurável).

## Licença

- Verificação Ed25519 depende de WebCrypto com Ed25519 (**Chrome 137+**). Em versões anteriores a
  licença fica `INVALIDA`; nada é liberado, mas a inspeção continua funcionando.
- Não há revogação online na v1.
- A licença não liga automação sozinha (depende de build + opt-in + calibração + guard).

## Sessão e abas

- “Conectado” exige heartbeat recente do content script; se o service worker dormir ou a aba for
  suspensa, o estado pode oscilar para “Aguardando” até o próximo sinal.
- Múltiplas abas do C2S: o registro guarda todas, mas screenshots usam a aba ativa e o motor escolhe
  uma aba primária.
- Não há suporte a outros domínios, subdomínios ou ambientes do C2S.

## Interface e idioma

- UI em pt-BR, sem internacionalização.
- Roteamento por hash; links diretos como `panel.html#/windows` funcionam.
- Sem tema escuro.

## Dados e desempenho

- IndexedDB pode crescer durante inspeções longas; use **Limpar amostras** e a retenção.
- Janelas terminais podem ser limpas em **Janelas → Limpar encerradas**.
- Amostras de rede são deduplicadas por hash em janela curta; chamadas idênticas repetidas podem ser
  colapsadas.
- Corpos de resposta são truncados (`LIMITS.maxNetworkBodyBytes`) e DOM em `LIMITS.maxDomBytes`.

## Escopo não implementado

- Nenhuma integração com servidor, telemetria ativa ou painel web.
- Nenhuma migração automática de dados entre versões além das migrações de schema.
- Nenhum teste E2E no navegador (apenas unitários com jsdom).
- Nenhuma política de assinatura de código/publicação na Chrome Web Store.

## Riscos externos

- Mudanças de layout/API do C2S podem quebrar parsers e seletores; a calibração precisa ser refeita.
- A extensão não é oficial e depende dos endpoints internos do C2S.
- Uso deve respeitar os termos do C2S e a LGPD.
