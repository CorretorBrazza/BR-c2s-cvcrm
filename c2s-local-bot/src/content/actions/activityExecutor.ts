import type { WindowActionResult } from '../../shared/types/window';

/**
 * Criação de atividade em lead normal — bloqueada de propósito.
 *
 * O C2S abre o modal de atividade por `GET /webapp/leads/<id>/activity?`
 * `action_modal=create_activity` e envia um formulário cujo corpo e campos
 * ainda não foram observados em nenhuma amostra. Inventar endpoint/campos
 * significaria escrever no CRM do corretor às cegas.
 *
 * Enquanto o contrato não for calibrado, esta função recusa sem tocar na
 * página. O engine continua detectando e alertando sobre o lead normal; só a
 * escrita automática fica bloqueada. Quando existir uma amostra manual real,
 * o executor passa a preencher o formulário e delegar o submit à própria
 * página (mesmo princípio click-first da captura).
 */
export function executeActivity(c2sLeadId: string): WindowActionResult {
  void c2sLeadId;
  return {
    ok: false,
    motivo: 'CONTRATO_NAO_CALIBRADO',
    etapa: 'contrato',
    retentavel: false,
    duracaoMs: 0,
  };
}
