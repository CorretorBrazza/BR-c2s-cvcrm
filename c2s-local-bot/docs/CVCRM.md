# CV CRM — mover etapa (2 → 4)

Módulo paralelo ao C2S, com o mesmo service worker, a mesma licença e as mesmas
notificações. Ele faz **uma** coisa: quando um lead novo cai na coluna
**Aguardando Atendimento Corretor** (id `2`), leva o lead para
**Em Atendimento** (id `4`).

Nada mais. Não arquiva, não descarta, não fecha negócio, não responde
mensagem, não transfere lead entre CRMs, não mexe em nenhuma outra coluna.

## 1. Por que clicar em vez de montar o POST

O CRM server-rendered muda a etapa com um `<a>` que executa:

```html
<a href="javascript:void(0)" onclick="modificarSituacao('4','Em Atendimento');">
  <span id="4" class="status inativo">Em Atendimento</span>
</a>
```

O caminho nativo é:

```text
modificarSituacao('4','Em Atendimento')
  → confirm("Deseja realmente alterar o lead #91293 para Em Atendimento ?")
  → document.getElementById('situacao_para').value = '4'
  → document.getElementById('form_situacao').submit()
```

O `submit()` faz a página montar o POST real, que carrega `post[...]` e um `tk`
de **128 hex** gerado em tempo de execução. Esse `tk` não está no DOM, não está
em nenhum script e não é reproduzível a partir do que a extensão vê — foi
verificado em HAR real e no dump do DOM vivo.

Conclusão de projeto: **a extensão nunca forja a requisição**. Ela clica o mesmo
`<a>` que o corretor clicaria e responde **um único** `confirm` — o do lead que
está sendo movido. Todo o transporte continua sendo responsabilidade da página.

## 2. Guard do `confirm`

`src/content/cvcrm/confirmGuard.ts` roda em **MAIN world** (`document_start`) e
substitui `window.confirm` por um wrapper que aceita automaticamente somente
quando **todas** as condições valem:

1. existe um lead armado;
2. o arm tem menos de 30 s (`CVRM_LIMITS.armTtlMs`);
3. a mensagem contém exatamente `alterar o lead #<id armado>`;
4. o arm é consumido no primeiro uso.

Em qualquer outro caso a chamada é repassada para o `confirm` original — o
diálogo do corretor continua funcionando. O arm é zerado em `pagehide`.

O executor (`src/content/cvcrm/executor.ts`) lê o painel, decide, arma o lead e
clica. Ele **não** usa `fetch`, `submit()`, `requestSubmit()` nem escreve em
`#situacao_para`: quem escreve é o handler da própria página.

## 3. Decisão (núcleo puro)

`src/shared/analysis/cvcrmPolicy.ts` decide com a leitura do painel:

| Situação | Resultado |
| --- | --- |
| lead já está na etapa 4 | `NOOP` (idempotente, nada é escrito) |
| etapa atual ≠ 2 | `BLOQUEADO` `NAO_E_DA_COLUNA_DE_ENTRADA` |
| nenhum `.status.ativo` | `BLOQUEADO` `ETAPA_ATUAL_DESCONHECIDA` |
| `.situacoes-workflow` ausente / `#form_situacao` ausente | `BLOQUEADO` `SEM_FORM` |
| mais de um `.situacoes-workflow` | `BLOQUEADO` `WORKFLOW_AMBIGUO` |
| `<a>` da etapa 4 ausente ou com outro handler | `BLOQUEADO` `ALVO_INDISPONIVEL` |
| lead da página ≠ lead pedido | `BLOQUEADO` `LEAD_DIVERGENTE` |
| tudo certo | `MOVER` 2 → 4 |

Regras que não podem ser afrouxadas:

- **A etapa é sempre o `id` numérico.** O kanban trunca o rótulo em ~24
  caracteres (`Aguardando Atendimento C...`) e `Leads Vencidos ` tem espaço à
  direita. Comparar rótulo é bug garantido.
- **`Descartado` (id 3) usa `chamaFacebox`**, um handler diferente. Nunca é
  acionável: o regex aceito é só `modificarSituacao('<id>', '<label>')`.
- Spans cinzas com `title="Indisponível"` não têm `<a>`: são lidos como
  `acionavel: false`, nunca clicados.

## 4. Fluxo do motor

`src/background/cvcrm/cvcrmEngine.ts`:

1. **Detecção** — o content script do kanban lê as colunas
   (`.aw-flow-col` → `situacoes][]=N` → `.cv-card` → `a.lead-lite[data-lead]`)
   e os toasts do próprio CRM (`ID Lead: <id>`). Nenhuma requisição de rede.
2. **Linha de base** — no primeiro uso, todo lead que já está na coluna de
   entrada é marcado e **nunca** é movido. Só leads novos entram.
3. **Elegibilidade** — precisa ter sido visto há pelo menos
   `cvcrmDelaySeconds` (padrão 5 s) e no máximo `cvcrmMaxAgeHours` (padrão 2 h),
   não pode estar na linha de base, e não pode ter nenhum movimento registrado.
4. **Execução** — abre a aba `https://<tenant>.cvcrm.com.br/corretor/comercial/leads/<id>/administrar`,
   espera o content script, pede o clique e fecha a aba no fim.
5. **Pós-check** — a página recarrega depois do `submit()`. Ela só conta como
   sucesso se `.situacoes-workflow .status.ativo` tiver id `4`.
6. **Falha** — sem confirmação em 25 s, aba fechada, ou qualquer bloqueio:
   o movimento vira `FALHA`/`BLOQUEADO`, o corretor recebe notificação e
   **aquele lead não é tentado de novo**.

O atraso de 5 s existe porque o lead pode aparecer no kanban antes de o banco
do CRM terminar de gravar — mover cedo demais pode ser revertido pelo próprio
CRM.

## 5. Gate (o que precisa estar verdadeiro)

`src/background/cvcrm/cvcrmGate.ts` exige **todas** as condições:

- build com `VITE_AUTOMATION_ENABLED=true`;
- `automationOptInAt` registrado (opt-in explícito);
- `botActive` ligado;
- `inspectMode` desligado;
- licença `VALIDA` ou `TOLERANCIA_OFFLINE`;
- `cvcrmEnabled` (módulo) ligado;
- `cvcrmAutoMove` (mover etapa) ligado;
- `baselineEm` definido.

A calibração do C2S **não** entra neste gate: o contrato do CV CRM foi lido de
páginas reais (painel, kanban e HAR do POST), não de uma amostra pendente.

## 6. Configurações

| Chave | Padrão | Limite | Para que serve |
| --- | --- | --- | --- |
| `cvcrmEnabled` | `false` | — | liga a observação do kanban/página do lead |
| `cvcrmAutoMove` | `false` | — | liga o clique de mudança de etapa |
| `cvcrmDelaySeconds` | `5` | 0–600 | espera entre ver o lead e clicar |
| `cvcrmMaxAgeHours` | `2` | 1–168 | acima disso, o lead é ignorado |
| `cvcrmDetection` | `TOAST` | `TOAST`/`KANBAN` | `TOAST` só observa o aviso nativo; `KANBAN` relê o quadro |
| `cvcrmPollSeconds` | `30` | 30–300 | intervalo de releitura (modo `KANBAN`) |
| `cvcrmHost` | `''` | — | tenant aprendido no primeiro heartbeat |

## 7. Primeira execução (roteiro vigiado)

Não ligue tudo e vá embora. A ordem é:

1. `npm run build` e **Recarregar** a extensão em `chrome://extensions`.
2. Confirme na aba **Licença** que o status é `VALIDA`.
3. Registre o opt-in da automação e desligue o **Modo inspeção**.
4. Abra o kanban do CV CRM numa aba e faça login.
5. Abra o painel → **CV CRM** › **Mover etapa** → **Definir linha de base**. O contador
   “ignorados na ativação” deve bater com a quantidade de leads na coluna
   amarela naquele instante.
6. Ligue o **Módulo CV CRM** (a automação ainda continua bloqueada por
   `cvcrmAutoMove`).
7. Confira a seção “Automação não liberada” — deve restar só
   “Mover etapa desligado”.
8. Deixe o corretor olhando o kanban e ligue **Mover etapa automaticamente**.
9. Aguarde o próximo lead real. O esperado: aba abre, ~5 s depois o CRM troca
   de etapa sozinho, a aba fecha, chega uma notificação
   “CV CRM: etapa alterada”, e o lead aparece em **Em Atendimento**.
10. Confira no painel o histórico: `CLICADO` → `CONFIRMADO`, com `2 → 4`.

Se o primeiro movimento falhar, **não** ligue de novo sem ler o painel: a falha
fica registrada com o motivo (`SEM_CONFIRMACAO_DE_ETAPA`, `MOVIMENTO_ABANDONADO`,
`ALVO_INDISPONIVEL`, `SESSAO_DO_CV_CRM_EXPIRADA`, `ABA_FECHADA`,
`ABA_NAO_RESPONDEU`, `LEAD_DIVERGENTE`, …).

## 8. Como desligar

- **Mover etapa automaticamente** desligado → o módulo continua observando, mas
  não clica.
- **Módulo CV CRM** desligado → o content script para de relatar; nada é lido.
- **Mover agora / Verificar agora** no painel só força um ciclo de leitura.
- **Limpar histórico** apaga a linha de base e o histórico: na próxima
  ativação, tudo que estiver na entrada vira linha de base de novo.

## 9. Sinais de layout mudado

O módulo falha fechado, então um layout novo aparece como bloqueio, nunca como
clique errado. Os sintomas e o que olhar:

| Sintoma | Significado |
| --- | --- |
| `SEM_FORM` | `#form_situacao` sumiu — a página do lead mudou |
| `WORKFLOW_AMBIGUO` | o CRM passou a renderizar dois `.situacoes-workflow` |
| `ALVO_INDISPONIVEL` | a etapa 4 deixou de ter `<a>` (bloqueio por permissão?) |
| `ETAPA_ATUAL_DESCONHECIDA` | nenhum `.status.ativo` — página em transição |
| nada detectado no kanban | o link do cabeçalho perdeu `situacoes][]=N` |

Em todos os casos: confira o recorte do DOM da página e ajuste
`src/shared/constants/cvcrm.ts`. O build falha se os arquivos obrigatórios não
forem gerados.

## 10. O que este módulo **não** faz

- não move para nenhuma etapa além da 4;
- não move lead que já estava na entrada quando a linha de base foi tirada;
- não retenta lead com falha;
- não exclui, arquiva, descarta ou cria atividade;
- não envia mensagem, nem trata clique em WhatsApp como interação;
- não faz requisição para o CRM fora das páginas que o corretor abriria;
- não envia nada para nenhum servidor.

## 11. Arquivos

| Arquivo | Papel |
| --- | --- |
| `src/shared/constants/cvcrm.ts` | etapas, seletores, handlers aceitos, limites |
| `src/shared/types/cvcrm.ts` | tipos do módulo |
| `src/shared/analysis/cvcrmPolicy.ts` | decisão, linha de base, elegibilidade (puro) |
| `src/content/cvcrm/panelReader.ts` | lê `.situacoes-workflow`, acha o `<a>` |
| `src/content/cvcrm/kanbanReader.ts` | lê colunas/cards e toasts |
| `src/content/cvcrm/confirmGuard.ts` | override escopado de `confirm` (MAIN world) |
| `src/content/cvcrm/executor.ts` | arma + clica no `<a>` nativo |
| `src/content/cvcrm/index.ts` | content script (ISOLATED, `document_end`) |
| `src/content/cvcrm/injected/confirmArm.ts` | entry do MAIN world |
| `src/background/cvcrm/cvcrmState.ts` | persistência sanitizada (`cvcrm:state`) |
| `src/background/cvcrm/cvcrmGate.ts` | motivos de bloqueio |
| `src/background/cvcrm/cvcrmEngine.ts` | tick, aba, execução, notificação |
| `src/panel/routes/CvCrm.tsx` | tela do módulo |

Testes: `tests/cvcrmPolicy.test.ts` (regras puras) e
`tests/cvcrmPanel.test.ts` (DOM real: painel, kanban, guard e execução).
