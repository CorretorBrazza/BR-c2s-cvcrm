import { describe, expect, it } from 'vitest';
import { PANEL_NAV, PANEL_ROUTES } from '@/shared/constants/defaults';

/**
 * A navegação é o contrato visual do painel: C2S e CV CRM são dois produtos com
 * o mesmo peso. Se alguém transformar o CV CRM em apêndice outra vez, quebra aqui.
 */
describe('navegação do painel', () => {
  it('abre na visão geral, sem grupo', () => {
    expect(PANEL_NAV[0]?.grupo).toBe('');
    expect(PANEL_NAV[0]?.itens).toEqual([{ path: 'dashboard', label: 'Visão geral' }]);
  });

  it('tem uma seção para cada produto', () => {
    const grupos = PANEL_NAV.map((grupo) => grupo.grupo);
    expect(grupos).toContain('C2S');
    expect(grupos).toContain('CV CRM');
    expect(grupos).toContain('Sistema');
  });

  it('coloca os dois produtos no mesmo nível, um ao lado do outro', () => {
    const grupos = PANEL_NAV.map((grupo) => grupo.grupo);
    const c2s = grupos.indexOf('C2S');
    const cv = grupos.indexOf('CV CRM');

    expect(c2s).toBeGreaterThan(-1);
    expect(cv).toBeGreaterThan(-1);
    // Nenhum grupo de infraestrutura entre os dois produtos.
    expect(cv - c2s).toBe(1);
  });

  it('mantém a rota do CV CRM acessível', () => {
    const cv = PANEL_NAV.find((grupo) => grupo.grupo === 'CV CRM');
    expect(cv?.itens.map((item) => item.path)).toEqual(['cvcrm']);
  });

  it('a lista plana cobre todos os itens, sem repetir caminho', () => {
    const total = PANEL_NAV.reduce((soma, grupo) => soma + grupo.itens.length, 0);
    expect(PANEL_ROUTES).toHaveLength(total);

    const caminhos = PANEL_ROUTES.map((item) => item.path);
    expect(new Set(caminhos).size).toBe(caminhos.length);

    for (const obrigatorio of ['dashboard', 'windows', 'leads', 'cvcrm', 'logs', 'settings']) {
      expect(caminhos).toContain(obrigatorio);
    }
  });
});
