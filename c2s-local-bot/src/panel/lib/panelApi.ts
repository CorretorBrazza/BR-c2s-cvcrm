import type { DataQuery, RuntimeMessage, RuntimeResponse } from '../../shared/types/messages';

export class PanelApiError extends Error {}

function hasRuntime(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

async function send<T>(message: RuntimeMessage): Promise<T> {
  if (!hasRuntime()) {
    throw new PanelApiError('Abra o painel como extensão do Chrome.');
  }
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T> | undefined;
  if (!response) throw new PanelApiError('Sem resposta do service worker.');
  if (!response.ok) throw new PanelApiError(response.error);
  return response.data;
}

export const panelApi = {
  query<T>(query: DataQuery): Promise<T> {
    return send<T>({ kind: 'panel:query', id: `q_${Date.now()}`, payload: query });
  },

  updateSettings(patch: Record<string, unknown>): Promise<unknown> {
    return send({ kind: 'settings:update', id: `s_${Date.now()}`, payload: patch as never });
  },

  toggleBot(active: boolean): Promise<unknown> {
    return send({ kind: 'bot:toggle', id: `b_${Date.now()}`, payload: { active } });
  },

  setInspection(enabled: boolean): Promise<unknown> {
    return send({ kind: 'inspection:set', id: `i_${Date.now()}`, payload: { enabled } });
  },

  requestScreenshot(): Promise<unknown> {
    return send({ kind: 'inspection:screenshot:request', id: `ss_${Date.now()}` });
  },

  captureDom(): Promise<unknown> {
    return send({ kind: 'inspection:capture-dom', id: `cd_${Date.now()}` });
  },

  profileSelectors(): Promise<unknown> {
    return send({ kind: 'inspection:profile-selectors', id: `ps_${Date.now()}` });
  },

  exportCalibration(includePii: boolean): Promise<unknown> {
    return send({ kind: 'calibration:export', id: `ce_${Date.now()}`, payload: { includePii } });
  },

  importCalibration(bundle: unknown): Promise<unknown> {
    return send({ kind: 'calibration:import', id: `ci_${Date.now()}`, payload: { bundle: bundle as never } });
  },

  confirmCalibration(): Promise<unknown> {
    return send({ kind: 'calibration:confirm', id: `cc_${Date.now()}` });
  },

  clearData(scope: 'inspection' | 'logs' | 'all'): Promise<unknown> {
    return send({ kind: 'data:clear', id: `dc_${Date.now()}`, payload: { scope } });
  },

  saveTemplate(payload: {
    templateId?: string;
    nome: string;
    tipo: 'DIRETO' | 'BOLSAO' | 'FOLLOWUP';
    conteudo: string;
  }): Promise<unknown> {
    return send({ kind: 'template:save', id: `ts_${Date.now()}`, payload });
  },

  deleteTemplate(templateId: string): Promise<unknown> {
    return send({ kind: 'template:delete', id: `td_${Date.now()}`, payload: { templateId } });
  },

  windowsTick(): Promise<unknown> {
    return send({ kind: 'windows:tick', id: `wt_${Date.now()}` });
  },

  confirmInteraction(c2sLeadId: string): Promise<{ confirmed: boolean }> {
    return send({
      kind: 'windows:interaction',
      id: `wi_${Date.now()}`,
      payload: { c2sLeadId, evidencia: 'MANUAL' },
    });
  },

  clearWindows(scope: 'terminal' | 'all'): Promise<{ removed: number }> {
    return send({ kind: 'windows:clear', id: `wc_${Date.now()}`, payload: { scope } });
  },

  auditSelectors<T>(): Promise<T> {
    return send<T>({ kind: 'panel:query', id: `wa_${Date.now()}`, payload: { type: 'windows:audit' } });
  },

  cvcrmBaseline<T>(): Promise<T> {
    return send<T>({ kind: 'cvcrm:baseline', id: `cb_${Date.now()}` });
  },

  cvcrmTick(): Promise<unknown> {
    return send({ kind: 'cvcrm:tick', id: `ct_${Date.now()}` });
  },

  cvcrmReset(): Promise<unknown> {
    return send({ kind: 'cvcrm:reset', id: `cr_${Date.now()}` });
  },
};

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
