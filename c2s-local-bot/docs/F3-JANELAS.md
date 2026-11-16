# Janelas de interação (F3)

## O produto não é "capturar do Bolsão"

O C2S entrega lead de duas formas: **pool** (Bolsão, onde vários corretores disputam o mesmo lead)
e **lista normal** (lead que já é seu). Nos dois casos existe um **prazo de interação**: se o
corretor não age, o lead esfria ou é perdido.

A F3 transforma isso em um motor por lead: **todo lead visto ganha uma janela com prazo, estado e
histórico**. O Bolsão é apenas o caso de prazo mais curto e mais disputado. Não existe promessa de
"capturar em série": a regra é **uma captura → protege → alerta → pausa**.

## Onde fica cada coisa

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Regras puras | `src/shared/analysis/windowPolicy.ts` | prazos, expiração, dedupe, pausa do pool, escolha da próxima janela, backoff |
| Prova de interação | `src/shared/analysis/interactionDetector.ts` | reconhece `POST /webapp/leads/super_reply` 2xx com `success:true` |
| Tipos | `src/shared/types/window.ts` | `LeadWindow`, `WindowProbeResult`, `WindowsOverview` etc. |
| Portão | `src/shared/analysis/actionGuard.ts` + `src/background/automation/automationGate.ts` | decide se uma ação pode rodar |
| Motor | `src/background/automation/windowEngine.ts` | tick, detecção, fila, captura, atividade, confirmação |
| Sondagem da página | `src/content/actions/windowProbe.ts` + `contactsParser.ts` | lê Bolsão e lista normal sem tocar na página |
| Captura | `src/content/actions/captureExecutor.ts` | fluxo click-first com confirmação |
| Atividade | `src/content/actions/activityExecutor.ts` | recusa até o contrato ser calibrado |
| Persistência | `src/background/storage/repositories/windowRepository.ts` | store IndexedDB `lead_windows` |
| Painel | `src/panel/routes/Windows.tsx` | lista, prazos, confirmação manual |

## Prazos

Configuráveis em **Configurações → Janela de interação**:

| Origem | Padrão | Faixa aceita |
| --- | --- | --- |
| Bolsão (`POOL`) | 3 min | 1–30 min |
| Lead normal (`NORMAL`) | 30 min | 5–1.440 min (24 h) |

O prazo começa na **chegada detectada**. Quando a página expõe um horário legível no card
(`<time>`/`datetime`), ele é usado — desde que não seja absurdo (futuro distante ou passado
antigo). Datas confusas caem para o horário da detecção.

### Contador do próprio C2S (fonte de verdade)

A lista renderiza `.bucket-time` com um `.timer-count[data-seconds]` que o C2S decrementa 1 vez por
segundo. Quando esse contador existe, ele manda no prazo — mas **nunca estende** o que o corretor
configurou: vale o menor dos dois (`deadlineWithTimer`). Sem contador, vale a configuração.

O contador é lido no card do Bolsão e na linha da lista normal, sem tocar em texto do lead.

## Estados

| Estado | Significado |
| --- | --- |
| `DETECTADO` | visto na página, sem ação disparada |
| `ACAO_PENDENTE` | na fila (ou aguardando backoff) |
| `ACAO_EXECUTADA` | ação feita no C2S, aguardando interação |
| `INTERACAO_CONFIRMADA` | evidência de interação; janela encerrada com sucesso |
| `BLOQUEADO` | guard/contrato/sessão impediram; pode voltar a tentar |
| `EXPIRADO` | o prazo venceu antes da ação (vira métrica) |
| `FALHA` | erro definitivo, sem retentativa |

`BLOQUEADO` é elegível de novo quando o motivo é retentável; `bloqueioRetentavel: false` (contrato
não calibrado, operação insegura) mantém a janela parada.

## Regra do Bolsão

1. O motor detecta um lead no pool e cria a janela.
2. Executa **no máximo uma captura**.
3. Se a captura deu certo, o pool fica **pausado** (`poolPaused`).
4. Um alerta local avisa que o lead é seu.
5. Só depois de **interação confirmada** o pool volta a ser monitorado.

Enquanto a pausa durar, leads normais continuam sendo monitorados e alertados; o que não acontece é
uma segunda captura do pool. A pausa é derivada do estado da janela (não é um botão): se a extensão
reiniciar, a pausa continua valendo.

Se a aba não estiver na página do Bolsão, a captura do pool fica bloqueada com aviso explícito — a
extensão **não navega sozinha** para `/webapp/bucket_leads`.

## Prova de interação

Só duas evidências encerram a pausa:

- **`SUPER_REPLY`** — `POST /webapp/leads/super_reply` com status 2xx e `{ success: true }`. É a
  resposta enviada pelo próprio C2S. Do corpo só o `id` do lead é lido, em memória; o texto da
  mensagem nunca é lido nem persistido.
- **`MANUAL`** — o corretor clica em **Confirmar interação** na tela **Janelas**.

Clique em WhatsApp, abrir conversa, copiar telefone ou qualquer coisa do gênero **nunca** conta.
A ponte MAIN/ISOLATED fica ligada continuamente para detectar `super_reply`; a **gravação** de
amostras continua restrita ao modo inspeção.

## Detecção

### Pool

- Cards ativos: `.bucket-lead-card`; o id vem de `onclick="openModalTakeLead(<id>, ...)"`.
- Histórico `.bucket-at-card` **nunca** é capturável.
- O pool só é usado quando: página do Bolsão visível, sem free tier (`#free_tier_enabled == "true"`,
  `.upgrade_bucket` visível ou `.free_tier_limit_reached` visível) e sem pausa local.

### Lista normal

Comparação com um baseline persistido (`windows:seen_normal`):

- Na primeira leitura, tudo que já está na lista é baseline — nenhum lead antigo vira janela.
- Novos = ids que aparecem **acima** do primeiro id conhecido.
- Linhas carregadas por scroll/renderização tardia (abaixo do primeiro conhecido) atualizam o
  baseline sem criar janela.
- Item com data de criação mais velha que a janela normal é ignorado.

Esse heurístico é deliberadamente conservador: prefere deixar de criar janela a inventar urgência
para lead antigo.

### Watchdog de layout (`SELETOR_SUSPEITO`)

O badge `#badged_bolsao` é a única testemunha independente do parser: ele é alimentado pelo C2S, não
pelo nosso código. Se o badge indica leads (`> 0`, visível) e o parser lê **zero** cards por 3
verificações seguidas, o motor registra `SELETOR_SUSPEITO` e notifica uma vez: é sinal de layout
novo, não de pool vazio. O bot não tenta adivinhar seletores — ele para e avisa.

Badge oculto é ignorado, porque o C2S o esconde quando o Bolsão zera (o texto pode ficar velho).

### Auditoria de seletores (Diagnóstico)

A tela **Diagnóstico** tem o botão **Auditar aba do C2S**: ele testa, na página atual, cada conceito
de `SELECTOR_CONCEPTS` e mostra quantos elementos casaram, quantos estão visíveis e uma assinatura
segura (`tag.classes`) do primeiro. Nenhum nome, telefone ou mensagem é lido.

Se um seletor que antes casava agora zera, a automação deixa de agir — e a auditoria mostra qual
quebrou antes de alguém culpar o C2S ou a licença.

O relatório também traz os **sinais do Bolsão**, que respondem “o pool está vazio ou o seletor
quebrou?” quando a tabela sozinha não responde: contagem publicada pelo C2S no badge (`#badged_bolsao`),
leads lidos pelo parser, cards ativos vs. cards de histórico, free tier, pausa por limite do C2S,
modais visíveis naquele instante, valor do contador de prazo e os ids do pool com o prazo publicado.
Um veredito em texto resume o caso — por exemplo, “C2S indica 2 lead(s), mas o parser leu 0 card(s):
o seletor do card provavelmente mudou”. `undefined` no badge significa que o C2S não publicou
contagem; badge oculto não vale como testemunha.

O relatório nunca inclui nome, telefone, mensagem nem o conteúdo dos cards: só contagem, ids e
assinatura de elementos.

## Ação

O tick roda a cada **30 s** (`chrome.alarms`, mínimo real do Chrome) e também é disparado quando o
content script avisa que o DOM mudou (`windows:signal`, no máximo 1 vez a cada 2 s).

Antes de agir, o motor:

1. revalida sessão/aba (probe novo — nunca age em DOM velho);
2. recalcula janelas elegíveis a cada iteração;
3. consulta o `actionGuard`;
4. só então escolhe a próxima janela (`selectNext`: pool primeiro, depois prazo mais curto).

### Captura (click-first)

1. Acha o card ativo do lead.
2. Clica no card (dispara `openModalTakeLead` da própria página).
3. Espera o modal de confirmação.
4. Confere de novo o modo inspeção.
5. Clica **uma única vez** no confirmar (outro clique seria outro POST).
6. Confirma o sucesso por URL `/webapp/leads/{id}` ou `#lead-info[data-id]`.

Se a navegação destruir o content script, o service worker confirma o sucesso relendo a URL da aba.
Falhas: `LEAD_INDISPONIVEL` (perdido para concorrente) e `NAO_INTERAGIDO` (gate do C2S) não são
retentadas; `CARD_AUSENTE`/`MODAL_NAO_ABRIU` entram em backoff exponencial (30 s → 5 min).

### Atividade (lead normal)

O modal/POST de criação de atividade **nunca foi observado** em uma amostra real. Por isso o
executor recusa com `CONTRATO_NAO_CALIBRADO` e a janela fica `BLOQUEADO` com
`bloqueioRetentavel: false`. O lead normal **é detectado e alertado**, mas a escrita automática está
desligada. Nenhum endpoint foi inventado.

## Automação liberada?

A ação só roda quando **todas** as condições valem:

1. build com `VITE_AUTOMATION_ENABLED=true` (padrão `false`);
2. opt-in registrado pelo corretor (`automationOptInAt`);
3. calibração confirmada;
4. modo inspeção desligado;
5. robô ativo e não pausado;
6. licença válida com a feature;
7. a opção específica ligada (`autoClaimPool` etc.);
8. `actionGuard` aprova a ação.

A tela **Janelas** lista os motivos de bloqueio ativos. A automação de atividade tem ainda
`FEATURE_FLAGS.activityAutomationEnabled = false`, independente de tudo acima.

## Limites reais de execução

O texto comercial honesto é:

> **Detecta e age em segundos enquanto o C2S estiver aberto e ativo no Chrome.**

O que isso significa na prática:

- **Detecção**: o sinal de DOM chega em até ~2 s; o tick de segurança é de 30 s. Com a aba aberta e
  o service worker acordado, a detecção é de segundos.
- **Ação**: depende do Chrome manter a aba executável. Com a aba em segundo plano, timers são
  estrangulados; depois de alguns minutos oculta, a página pode ser **congelada**; sob pressão de
  memória pode ser **descartada**. Nesses casos o clique não roda até a aba voltar a executar.
- **Hibernação/suspensão da máquina**: nada roda. Os alarmes disparam atrasados uma vez ao acordar.
  Se o intervalo entre ticks passar de 2 min, o motor registra `SUSPENSION_DETECTED`, revalida a
  sessão e só age depois de um probe novo.

Mitigações implementadas:

- relógio no service worker via `chrome.alarms` (não depende de `setInterval` da página);
- `chrome.tabs.update(tabId, { autoDiscardable: false })` na aba do C2S;
- opção **Trazer a aba do C2S para frente ao agir** (padrão ligada), com ~1,2 s de folga antes do
  clique;
- nenhuma espera por `requestAnimationFrame`;
- após retomada, nunca age com DOM velho: um probe novo antecede qualquer ação.

O que **não** é prometido: captura com a aba fechada, com o Chrome fechado, com o computador
dormindo, nem "captura em série" de vários leads do Bolsão.

## Operação

- **Janelas**: lista com prazo, restante, estado, motivo de bloqueio e ações (tentar agora,
  confirmar interação, limpar encerradas, apagar tudo).
- **Dashboard**: cartão com pausa do Bolsão, janelas ativas, bloqueadas, protegidas e se a aba
  respondeu.
- **Configurações**: prazos, opt-in, trazer aba para frente, toggles de automação.
- **Diagnóstico**: versão do build (automação e chave de licença embutidas), checks de sessão,
  auditoria de seletores e exportação/cópia do relatório.

Limpar dados (`Configurações → Apagar todos os dados`) também apaga as janelas e o baseline da
lista normal.

## O que continua em aberto

- Markup real de `.bucket-lead-card` com lead no pool (o dump disponível não tinha card ativo).
- Contrato do POST de captura após a primeira captura real (`postConfirmado: false`).
- Modal/POST de criação de atividade: precisa de **uma amostra manual** com inspeção ligada e
  bundle exportado. Sem isso, a escrita em lead normal permanece bloqueada.
