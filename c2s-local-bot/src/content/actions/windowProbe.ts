import type { WindowProbeResult } from '../../shared/types/window';
import { parseBucketDom } from '../parsers/bucketParser';
import { isContactsListVisible, parseContactsDom } from '../parsers/contactsParser';
import { detectPageContext } from '../parsers/pageContext';
import { isVisible, qs, textOf } from '../utils/domUtils';

/**
 * Quantos leads o C2S DIZ que há no Bolsão (`#badged_bolsao`).
 *
 * É a única testemunha independente do parser: se o badge indica leads e o DOM
 * não tem card nenhum, o seletor quebrou — e o bot precisa avisar em vez de
 * fingir que o pool está vazio.
 */
function readBolsaoBadge(): number | undefined {
  const badge = qs('#badged_bolsao');
  if (!badge) return undefined;
  // O C2S esconde o badge quando o Bolsão está vazio, mas pode deixar o texto
  // antigo no elemento. Badge oculto não é testemunha de nada.
  if (badge instanceof HTMLElement && badge.hidden) return undefined;
  if (/display\s*:\s*none/i.test(badge.getAttribute('style') ?? '')) return undefined;

  const raw = textOf(badge, 20).replace(/\D+/g, '');
  if (!raw) return undefined;
  const total = Number(raw);
  return Number.isFinite(total) && total >= 0 ? total : undefined;
}


/**
 * Leitura passiva da página atual.
 *
 * Não clica, não navega, não altera nada. O engine usa isto para saber se há
 * lead novo e se a ação é possível agora. Se a aba estiver em outra tela, a
 * resposta é honesta: `bucketVisivel: false`, `pool: []`.
 */
export function probeWindows(): WindowProbeResult {
  const page = detectPageContext();
  const bucketVisivel = page.context === 'BUCKET';
  const listaNormalVisivel = page.context === 'CONTACTS_LIST' && isContactsListVisible();

  let pool: WindowProbeResult['pool'] = [];
  let bolsaoPausadoPeloC2s = false;

  if (bucketVisivel) {
    const snapshot = parseBucketDom();
    bolsaoPausadoPeloC2s = snapshot.freeTierLimitReached;
    pool = snapshot.itens.map((item) => ({
      c2sLeadId: item.c2sLeadId,
      origem: 'POOL' as const,
      ...(item.nome ? { nome: item.nome } : {}),
      ...(item.criadoEm ? { criadoEm: item.criadoEm } : {}),
      ...(item.segundosRestantes !== undefined
        ? { segundosRestantes: item.segundosRestantes }
        : {}),
      confianca: item.confianca,
    }));
  }

  const bolsaoIndicado = readBolsaoBadge();

  const freeTierInput = qs<HTMLInputElement>('#free_tier_enabled');
  const upgradeBox = qs('.upgrade_bucket');
  const freeTier =
    freeTierInput?.value === 'true' || (upgradeBox !== null && isVisible(upgradeBox));
  const normal = listaNormalVisivel ? parseContactsDom() : [];

  const observacoes: string[] = [];
  if (freeTier) observacoes.push('Conta em free tier: o próprio C2S bloqueia a captura.');
  if (bolsaoPausadoPeloC2s) observacoes.push('Limite do Bolsão atingido no C2S.');
  if (listaNormalVisivel && normal.length === 0) observacoes.push('Lista de contatos sem leads renderizados.');
  if (bolsaoIndicado !== undefined && bolsaoIndicado > 0 && pool.length === 0) {
    observacoes.push(
      `C2S indica ${bolsaoIndicado} lead(s) no Bolsão, mas nenhum card foi lido: possível mudança de layout.`,
    );
  }

  return {
    abaC2s: page.sessaoValida && page.context !== 'LOGIN' && page.context !== 'UNKNOWN',
    contexto: page.context,
    url: page.url,
    bucketVisivel,
    freeTier,
    bolsaoPausado: bolsaoPausadoPeloC2s,
    pool,
    normal,
    listaNormalVisivel,
    ...(bolsaoIndicado !== undefined ? { bolsaoIndicado } : {}),
    observacoes,
  };
}
