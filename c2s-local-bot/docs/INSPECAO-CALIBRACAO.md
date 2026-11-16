# Inspeção e calibração

## Por que calibrar

O robô não pode agir com base em suposições. Antes de liberar qualquer automação, a extensão precisa
de **evidência real** de como o C2S responde: endpoints, métodos, payloads, CSRF, formato de
resposta, seletores e tempo. O modo inspeção coleta essa evidência e a transforma em um bundle
auditável.

Enquanto a inspeção está ligada, a extensão **não captura, não move, não cria atividade e não envia
mensagem**. Ela apenas observa. O motor de janelas (F3) continua detectando leads e prazos, mas
`actionGuard` bloqueia qualquer ação real enquanto `inspectMode` estiver ativo.

## Como coletar

1. Abra o painel → **Inspeção**. Confirme que o modo inspeção está **ligado**.
2. Deixe a aba do C2S aberta e faça login.
3. Navegue nesta ordem (a ordem ajuda a cobrir todos os mínimos):
   1. **Lista de leads** (`/webapp/leads/v2`) — role a lista para gerar chamadas.
   2. **Bolsão** (`/webapp/bucket_leads`) — espere os cards renderizarem.
   3. Abra o **detalhe de um lead**.
   4. Volte ao Bolsão.
4. Nas páginas principais (lista, Bolsão, detalhe), use **Capturar HTML** e **Perfil de seletores**.
   No Bolsão, **Capturar HTML é obrigatório**: é dessa amostra que saem o contrato da lista pelo DOM
   e o contrato do POST a partir do script `takeLeadToMe` da própria página.
5. Opcional: **Screenshot** para registrar o layout (requer a aba do C2S ativa na janela).

> **Não é preciso capturar um lead de verdade.** A captura real fica como confirmação final do POST
> e não bloqueia a calibração.

A extensão também amostra DOM/seletores automaticamente ao trocar de contexto, com limites de
frequência (DOM a cada 5 s, screenshot a cada 10 s).

> **Ponte sempre ligada, gravação só na inspeção.** A ponte MAIN/ISOLATED fica ativa continuamente
> para reconhecer a prova de interação (`POST /webapp/leads/super_reply` 2xx com `success:true`).
> Desse evento só o `id` do lead é lido, em memória; o texto da mensagem não é lido nem persistido.
> Fora do modo inspeção, nenhuma amostra é gravada.

## O que é gravado por amostra de rede

- URL completa, método e status HTTP
- headers da requisição (sem `cookie`, `authorization`, `set-cookie`; `x-csrf-token` é redigido)
- payload enviado e corpo da resposta (limitados por `LIMITS.maxNetworkBodyBytes`)
- tipo de endpoint classificado (`BUCKET_LEADS`, `LEADS_V2`, `LEAD_DETAIL`, `FUNNEL_MOVE`, etc.)
- contexto da página, duração em ms e timestamp
- flag `untrusted: true` — tudo que vem da página é tratado como não confiável

Se **Incluir PII nas amostras** estiver desligado (padrão), telefone, e-mail, CPF e tokens são
mascarados antes de persistir e antes de exportar.

### Evidência de script (sem PII)

A amostra de DOM carrega também `captureScript`, extraído **apenas** do bloco `takeLeadToMe` da
página. Ele guarda fatos fixos:

- método do POST e método do GET de pré-checagem;
- caminho `/bucket_leads/{id}`;
- navegação de sucesso `/webapp/leads/{id}`;
- sinal de não-captura `redirect_to_upselling`;
- presença de `<meta name="csrf-token">` (Rails).

O script bruto nunca é persistido e nenhum texto livre é copiado.

## Mínimos para confirmar

### Bloqueiam a confirmação

| Amostra | Mínimo |
| --- | --- |
| Visita à página do Bolsão | 1 |
| Amostras de DOM | 2 |
| Perfis de seletor | 1 |
| Contrato da lista do Bolsão (rede **ou** DOM) | 1 |
| Contrato de captura (rede **ou** script) | 1 |

### Não bloqueiam (avisos)

- `GET /bucket_leads/{id}` não observado.
- `POST /bucket_leads/{id}` **a confirmar na primeira captura real**.
- Resposta de `/webapp/leads/v2` não observada.
- Página de detalhe do lead / lista de contatos não visitadas.
- Lista do Bolsão derivada do DOM (sem resposta de rede).
- Bolsão vazio nas amostras.

A tela **Inspeção → Cobertura das amostras** mostra `atual/mínimo`, as **pendências** (bloqueiam) e
os **avisos** (não bloqueiam). O botão **Confirmar calibração** habilita quando não há pendências.

As contagens seguem regras estritas:

- **Resposta da lista do Bolsão**: precisa ser `GET /webapp/bucket_leads` com status `2xx` e corpo.
  Uma captura `POST /bucket_leads/{id}` **não** conta como lista.
- **Página do Bolsão / lista de contatos / detalhe do lead**: contam tanto amostras de rede com
  contexto da página quanto amostras de DOM daquela página.
- **`GET`/`POST` de captura**: contam chamadas em `/bucket_leads/{id}` (o `POST` é a aprovação real;
  o `GET` é a pré-checagem).

## Contrato detectado

Ainda na tela **Inspeção**, o cartão **Contrato detectado** resume o que as amostras provam:

- **lista do Bolsão**: endpoint, formato, chaves e `origem` (`REDE`, `DOM` ou `SCRIPT`). Quando vem
  do DOM, mostra quantos cards há no pool ativo (`.bucket-lead-card`) — o histórico
  "Últimos 10 leads" (`.bucket-at-card`) **nunca** é contado como capturável;
- **captura**: caminho, payload, headers CSRF, sinais de sucesso/falha, `origem` e
  `postConfirmado`. Sem POST 2xx, fica explicitamente **"a confirmar"**;
- **gate de interação**: presença do modal `#modal_bucket_lead_not_interacted`, valor real de
  `#free_tier_enabled` (`true`/`false`/`ausente`) e se há bloqueio;
- **seletores críticos** validados e os que ainda faltam;
- **conflitos** e **pendências** que impedem fechar o contrato.

O free tier só é reportado como bloqueio quando `#free_tier_enabled` vale `true`, quando o banner
`.upgrade_bucket` está visível ou quando o modal de limite está **visível**. O modal oculto que
existe em toda página do Bolsão não conta.

Use **Copiar contrato** para enviar o relatório em JSON sem PII (apenas caminhos, chaves e sinais
fixos são copiados).

## Como confirmar

1. Verifique que não há pendências (avisos podem permanecer).
2. Clique em **Confirmar calibração**.
3. O SW grava `confirmedAt` + `appFingerprint` (versão + hash do user agent) em
   `calibration/current` e nas configurações.

> A confirmação **não liga a automação**. Ela apenas registra que o contrato foi validado. A
> liberação efetiva depende de `VITE_AUTOMATION_ENABLED=true`, opt-in registrado, licença válida,
> robô ativo, modo inspeção desligado e aprovação do `actionGuard` em cada ação. No build de fábrica
> a flag é `false`.

## Exportar / importar bundle

- **Exportar bundle (sem PII)** — recomendado para enviar ao suporte/análise.
- **Exportar bundle (com PII)** — inclui telefones/e-mails; use só em canal seguro.
- **Importar bundle** — valida `bundleVersion: 1`, normaliza cada amostra e marca como importada
  (`untrusted: true`).

O bundle contém versão da extensão, data, contagens, amostras de rede, DOM e seletores. Ele também
inclui o **contrato detectado** (sem PII), para que a análise comece pelo resumo e não pela leitura
manual de todas as amostras.

## Limpar

**Limpar amostras** apaga amostras e a confirmação de calibração. Não afeta leads, logs ou
configurações. Para apagar tudo, use **Configurações → Apagar todos os dados**.

## O que ainda falta descobrir no C2S

- **Headers do POST** de captura na primeira execução real (a página expõe `csrf-token`; a captura
  por clique usa a requisição do próprio C2S, que já envia o header).
- **Markup do card do pool ativo** (`.bucket-lead-card`) quando houver lead — o ID vem do
  `onclick="openModalTakeLead(<id>, ...)"`.
- **Contrato de criação de atividade em lead normal**: o modal (`GET
  /webapp/leads/<id>/activity?action_modal=create_activity`) e o `POST` do formulário nunca foram
  observados. Até existir uma amostra manual com inspeção ligada, o executor recusa com
  `CONTRATO_NAO_CALIBRADO` e nenhuma escrita é feita.

O gate de interação já está resolvido: a prova automática é `POST /webapp/leads/super_reply` 2xx com
`success:true`, ou a confirmação manual no painel. Clique em WhatsApp não conta.

Os pontos acima são resolvidos com amostras reais, não por tentativa e erro em produção.

## Dicas

- **Não** é necessário capturar um lead real para calibrar; a captura manual de teste deixou de ser
  requisito.
- Se o Bolsão estiver vazio, o contrato da lista sai do DOM com confiança `BAIXA`/`MEDIA` e um aviso.
  Isso não impede confirmar a calibração.
- Deixe a aba do C2S em foco ao pedir screenshot.
- Não confirme a calibração com pendências abertas: a mensagem lista exatamente o que falta.
- Se o bundle ficar grande, exporte sem PII e antes limpe amostras antigas.
