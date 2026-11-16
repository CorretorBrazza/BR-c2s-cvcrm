# Privacidade e segurança

## Princípio

**Local-first por padrão.** A extensão funciona sem servidor. Nenhum dado de lead, conversa,
credencial ou amostra sai do navegador a menos que você exporte manualmente um arquivo.

## O que a extensão NUNCA faz

- Não armazena senha, token de sessão ou cookie do C2S.
- Não faz login em seu nome.
- Não envia dados para servidores por padrão (telemetria desligada).
- Não injeta código remoto, não usa `eval` nem `new Function`.
- Não lê páginas fora de `https://api.contact2sale.com/*`.
- Não usa a permissão `tabs` para varrer suas abas.
- Não captura tela de outras abas: `captureVisibleTab` só enxerga a aba ativa da janela.

## Permissões e justificativa

| Permissão | Para quê |
| --- | --- |
| `storage` | configurações e estado local |
| `unlimitedStorage` | IndexedDB com histórico de amostras/logs |
| `alarms` | watchdog (30 s), retenção (24 h), licença (6 h) |
| `notifications` | alertas locais de captura/perda |
| `offscreen` | tocar o alerta sonoro sem arquivo externo |
| `sidePanel` | abrir o painel lateral |
| `host_permissions: api.contact2sale.com` | única origem acessada |

Não há `activeTab`, `scripting`, `tabs`, `web_accessible_resources` nem `default_popup`. O content
script é declarado estaticamente para o domínio do C2S.

## Dados armazenados

| Dado | Onde | Retenção padrão |
| --- | --- | --- |
| Leads detectados | IndexedDB | 90 dias |
| Logs técnicos | IndexedDB | 30 dias |
| Métricas diárias/mensais | IndexedDB | 12 meses |
| Amostras de inspeção (rede/DOM/seletores) | IndexedDB | até limpar/exportar |
| Janelas de interação (lead, origem, prazos, estado) | IndexedDB | até limpar / retenção de leads |
| Baseline da lista normal (ids já vistos) | `chrome.storage.local` | 7 dias por id |
| Screenshots | IndexedDB | 7 dias, máx. 200 |
| Configurações, licença, sessão, fila | `chrome.storage.local` | até apagar/desinstalar |

A limpeza roda por alarme diário (`retentionService`) e também ao gravar screenshots.

## Mascaramento

`background/security/dataMasking.ts` mascara, antes de persistir e ao exportar sem PII:

- telefones (formato BR)
- e-mails
- CPF
- tokens/segredos em texto (`authenticity_token`, `csrf`, `bearer`, etc.)

Headers sensíveis (`cookie`, `authorization`, `set-cookie`) são removidos já no content script;
`x-csrf-token` é substituído por `[REDACTED]` no service worker.

## Fronteira de confiança MAIN ↔ ISOLATED

O interceptor roda no mundo da página, portanto é **hostil por definição**. A ponte:

1. Gera um nonce aleatório de 128 bits no MAIN e faz `HELLO` a cada 250 ms (máx. 20 tentativas).
2. O ISOLATED aceita o primeiro nonce válido e ignora qualquer envelope com nonce diferente.
3. Valida `event.source === window` e `event.origin === location.origin`.
4. Valida o formato do envelope e do evento (URL, método, tamanho de corpo).
5. Aplica rate limit de 120 eventos/s.
6. Só persiste amostras quando o modo inspeção está ativo. A ponte fica ligada continuamente
   apenas para reconhecer `POST /webapp/leads/super_reply` 2xx; desse evento só o `id` do lead é
   lido, em memória. O texto da mensagem não é lido nem gravado.

Nada vindo do MAIN é tratado como comando: o conteúdo da página nunca decide qual ação executar. A
única decisão automática baseada na ponte é encerrar a pausa do Bolsão quando o próprio C2S confirma
o envio de uma resposta (`success:true`) para aquele lead.

Em modo inspeção não há captura, movimentação, atividade ou mensagem. A própria UI e o serviço
respeitam esse bloqueio.

## Superfície de risco conhecida

- **XSS no C2S**: um script malicioso na página pode tentar forjar mensagens na ponte. O nonce, a
  validação de origem e o rate limit reduzem o impacto, mas não eliminam a possibilidade de
  amostras falsas. Por isso toda amostra é marcada `untrusted`.
- **Screenshots**: podem conter dados de outros leads visíveis na tela. Ficam locais e expiram em
  7 dias.
- **Bundle exportado**: se você exportar com PII, o arquivo passa a viver fora da extensão. Trate-o
  como dado sensível.
- **Licença**: a chave pública fica no build; a privada nunca. Validação é offline.

## Boas práticas recomendadas

- Mantenha a inspeção ligada só enquanto coleta amostras.
- Exporte bundles **sem PII** para suporte.
- Use **Configurações → Apagar todos os dados** ao trocar de máquina/conta.
- Não instale builds de terceiros: o build é reproduzível a partir deste repositório.

## Direitos do titular (LGPD)

Como os dados nunca saem do seu navegador, o controle é local:

- **Acesso/portabilidade**: exportar logs, métricas e bundle.
- **Eliminação**: *Apagar todos os dados* ou desinstalar a extensão.
- **Minimização**: PII mascarada por padrão; retenção curta para screenshots.
