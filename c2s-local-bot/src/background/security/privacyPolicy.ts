/**
 * Política de privacidade em código: o painel exibe este resumo e os docs
 * (docs/PRIVACIDADE.md) replicam o mesmo conteúdo.
 */
export const PRIVACY_POLICY = {
  versao: '1.0.0',
  armazenamento: 'local (IndexedDB + chrome.storage.local do próprio navegador)',
  envioExterno: {
    padrao: 'nenhum',
    licenca: 'nenhum na v1 (licença offline assinada)',
    telemetria: 'opt-in explícito, apenas contadores agregados',
  },
  dadosColetados: [
    'IDs de leads do C2S e dados públicos do lead visíveis na tela (nome, telefone, imóvel, origem)',
    'Eventos técnicos das ações do robô (endpoint, status HTTP, duração, resultado)',
    'Amostras de rede/DOM/screenshot apenas enquanto o modo inspeção estiver ativo',
  ],
  nuncaColetados: [
    'Senha do C2S',
    'Cookies de sessão',
    'Conteúdo de conversas além do necessário para registrar a interação',
    'Dados de outros corretores ou empresas',
  ],
  controles: [
    'Pausar o robô a qualquer momento',
    'Desligar automações individualmente',
    'Exportar todos os dados locais (JSON/CSV)',
    'Apagar todos os dados locais',
    'Desligar telemetria (padrão: desligada)',
  ],
  retencao: {
    logsTecnicosDias: 30,
    dadosLeadDias: 90,
    metricasMeses: 12,
    screenshotsDias: 7,
  },
} as const;

export type PrivacyPolicy = typeof PRIVACY_POLICY;

export function privacySummaryLines(): string[] {
  return [
    `Armazenamento: ${PRIVACY_POLICY.armazenamento}`,
    `Envio externo padrão: ${PRIVACY_POLICY.envioExterno.padrao}`,
    `Retenção: logs ${PRIVACY_POLICY.retencao.logsTecnicosDias}d, leads ${PRIVACY_POLICY.retencao.dadosLeadDias}d, métricas ${PRIVACY_POLICY.retencao.metricasMeses}m, screenshots ${PRIVACY_POLICY.retencao.screenshotsDias}d`,
  ];
}
