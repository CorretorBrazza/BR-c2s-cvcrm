import { CVRM_LIMITS } from '../../shared/constants/cvcrm';

/**
 * Guard do `confirm()` da página do lead (MAIN world).
 *
 * O caminho nativo de mudança de etapa é:
 *
 *   <a onclick="modificarSituacao('4','Em Atendimento')">
 *      -> confirm("Deseja realmente alterar o lead #91293 para Em Atendimento ?")
 *      -> document.getElementById('situacao_para').value = '4'
 *      -> document.getElementById('form_situacao').submit()
 *
 * O `submit()` faz a página montar o POST real (com `post[...]` e o `tk` de 128
 * hex gerado em tempo de execução). Replicar esse POST é impossível e inseguro,
 * então o robô apenas clica o mesmo `<a>` que o corretor clicaria. Para isso,
 * exatamente UM `confirm` é respondido automaticamente: o do lead armado.
 *
 * Fora desse caso, o comportamento da página é preservado — inclusive o
 * diálogo real do corretor.
 */

export const ARM_EVENT = 'c2s:cvcrm:arm';

export interface ArmPayload {
  leadId: string;
}

export interface ConfirmGuardHandle {
  /** true = a próxima confirmação do lead armado será aceita sozinha. */
  armado: () => string | null;
}

interface GuardWindow extends Window {
  __C2S_CV_GUARD__?: boolean;
}

const LEAD_ID = /^\d{1,20}$/;

export function installConfirmGuard(
  win: GuardWindow,
  ttlMs: number = CVRM_LIMITS.armTtlMs,
): ConfirmGuardHandle {
  let armado: { leadId: string; em: number } | null = null;

  const instalar = (): void => {
    const original = win.confirm.bind(win);

    win.confirm = (mensagem?: string): boolean => {
      if (armado && Date.now() - armado.em <= ttlMs) {
        const texto = typeof mensagem === 'string' ? mensagem : '';
        // A mensagem do CRM é "…alterar o lead #<id> para <etapa> ?". Exigir o
        // id impede aceitar por engano o confirm de outro lead.
        if (texto.includes(`alterar o lead #${armado.leadId}`)) {
          armado = null;
          return true;
        }
      }
      return original(mensagem);
    };

    win.addEventListener(
      ARM_EVENT,
      (event) => {
        const detalhe = (event as CustomEvent<unknown>).detail;
        const payload = lerPayload(detalhe);
        if (payload) armado = { leadId: payload.leadId, em: Date.now() };
      },
      true,
    );

    win.addEventListener('pagehide', () => {
      armado = null;
    });
  };

  if (!win.__C2S_CV_GUARD__) {
    win.__C2S_CV_GUARD__ = true;
    instalar();
  }

  return { armado: () => armado?.leadId ?? null };
}

function lerPayload(detalhe: unknown): ArmPayload | null {
  if (typeof detalhe === 'string') {
    try {
      const parsed = JSON.parse(detalhe) as Partial<ArmPayload>;
      return typeof parsed.leadId === 'string' && LEAD_ID.test(parsed.leadId)
        ? { leadId: parsed.leadId }
        : null;
    } catch {
      return null;
    }
  }
  if (typeof detalhe === 'object' && detalhe !== null) {
    const leadId = (detalhe as Partial<ArmPayload>).leadId;
    if (typeof leadId === 'string' && LEAD_ID.test(leadId)) return { leadId };
  }
  return null;
}
