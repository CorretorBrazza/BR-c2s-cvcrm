import type {
  BucketListContract,
  CalibrationContract,
  CaptureContract,
  CaptureScriptEvidence,
  ContractConfidence,
  ContractEvidence,
  ContractOrigin,
  DomSample,
  InteractionGateContract,
  NetworkSample,
  SelectorContract,
  SelectorProfile,
} from '../types/inspection';
import { AUTOMATION_CONCEPTS, type SelectorConcept } from '../constants/selectors';
import { nowIso } from '../utils/dateUtils';
import { parseJsonSafe } from '../utils/validation';
import { isBucketCapturePath, isBucketListPath, isSuccessStatus } from './calibrationCounts';

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

function evidenceOf(samples: NetworkSample[]): ContractEvidence {
  const timestamps = samples.map((sample) => sample.timestamp).filter(Boolean).sort();
  return {
    amostras: samples.length,
    ...(timestamps[0] ? { primeiraEm: timestamps[0] } : {}),
    ...(timestamps[timestamps.length - 1] ? { ultimaEm: timestamps[timestamps.length - 1] } : {}),
  };
}

function latest(samples: NetworkSample[]): NetworkSample | undefined {
  return [...samples].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
}

function latestDom(samples: DomSample[]): DomSample | undefined {
  return [...samples].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
}

function objectKeys(value: unknown, max = 40): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, max);
}

function itemKeysOf(items: unknown[]): string[] {
  const keys = new Set<string>();
  for (const item of items.slice(0, 5)) {
    for (const key of objectKeys(item)) {
      if (keys.size >= 40) break;
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function findItems(root: unknown): { caminhoItens?: string; itens: unknown[] } {
  if (Array.isArray(root)) return { caminhoItens: 'raiz', itens: root };
  if (typeof root !== 'object' || root === null) return { itens: [] };

  const entries = Object.entries(root as Record<string, unknown>);
  const preferred = ['bucket_leads', 'leads', 'data', 'results', 'items', 'records'];
  for (const name of preferred) {
    const value = (root as Record<string, unknown>)[name];
    if (Array.isArray(value)) return { caminhoItens: name, itens: value };
  }
  for (const [name, value] of entries) {
    if (Array.isArray(value)) return { caminhoItens: name, itens: value };
  }
  return { itens: [] };
}

function parseBody(body: string | null | undefined): { kind: 'JSON' | 'HTML' | 'VAZIO' | 'DESCONHECIDO'; value?: unknown } {
  if (typeof body !== 'string' || body.trim() === '') return { kind: 'VAZIO' };
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonSafe<unknown>(trimmed);
    if (parsed !== null) return { kind: 'JSON', value: parsed };
    return { kind: 'DESCONHECIDO' };
  }
  if (trimmed.startsWith('<')) return { kind: 'HTML' };
  return { kind: 'DESCONHECIDO' };
}

function bucketListContract(network: NetworkSample[], dom: DomSample[]): BucketListContract | null {
  const candidates = network.filter(
    (sample) =>
      sample.endpointType === 'BUCKET_LEADS' &&
      isBucketListPath(pathOf(sample.url)) &&
      isSuccessStatus(sample.status),
  );
  const withBody = candidates.filter(
    (sample) => typeof sample.responseBody === 'string' && sample.responseBody.trim() !== '',
  );
  const sample = latest(withBody) ?? latest(candidates);

  if (sample) {
    const parsed = parseBody(sample.responseBody);
    const chavesResposta = parsed.kind === 'JSON' ? objectKeys(parsed.value) : [];
    const { caminhoItens, itens } = parsed.kind === 'JSON' ? findItems(parsed.value) : { itens: [] as unknown[] };
    const chavesItem = itemKeysOf(itens);

    const confianca: ContractConfidence =
      parsed.kind === 'JSON' && chavesItem.length > 0
        ? 'ALTA'
        : parsed.kind === 'JSON'
          ? 'MEDIA'
          : parsed.kind === 'HTML'
            ? 'MEDIA'
            : 'BAIXA';

    return {
      metodo: sample.method.toUpperCase(),
      caminho: pathOf(sample.url),
      ...(sample.status !== undefined ? { status: sample.status } : {}),
      formato: parsed.kind,
      chavesResposta,
      ...(caminhoItens ? { caminhoItens } : {}),
      chavesItem,
      origem: 'REDE',
      confianca,
      evidencia: evidenceOf(candidates),
    };
  }

  return bucketListDomContract(dom);
}

/**
 * Sem resposta de rede (a página pode ser renderizada no servidor), deriva o
 * contrato da estrutura do DOM. Só conta cards do Bolsão ATIVO
 * (`.bucket-lead-card`); o histórico `.bucket-at-card` fica de fora.
 */
function bucketListDomContract(dom: DomSample[]): BucketListContract | null {
  const bucketSamples = dom.filter((sample) => sample.context === 'BUCKET');
  const sample = latestDom(bucketSamples) ?? latestDom(dom);
  if (!sample) return null;

  const hasContainer = /class\s*=\s*["'][^"']*\bbucket-list\b/i.test(sample.html);
  if (!hasContainer) return null;

  const classes = new Set<string>();
  let totalNoPool = 0;
  for (const match of sample.html.matchAll(/\bclass\s*=\s*["']([^"']*\bbucket-lead-card\b[^"']*)["']/gi)) {
    totalNoPool++;
    for (const token of (match[1] ?? '').split(/\s+/)) {
      if (token.startsWith('bucket-')) classes.add(token);
    }
  }

  return {
    metodo: 'GET',
    caminho: '/webapp/bucket_leads',
    formato: 'HTML',
    chavesResposta: [],
    chavesItem: [],
    origem: 'DOM',
    totalNoPool,
    cardClasses: Array.from(classes).slice(0, 10),
    confianca: totalNoPool > 0 ? 'MEDIA' : 'BAIXA',
    evidencia: { amostras: bucketSamples.length },
  };
}

function payloadFormat(body: string | null | undefined): {
  formato: CaptureContract['formatoPayload'];
  chaves: string[];
} {
  if (typeof body !== 'string' || body.trim() === '') return { formato: 'VAZIO', chaves: [] };
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonSafe<unknown>(trimmed);
    return { formato: 'JSON', chaves: objectKeys(parsed, 30) };
  }
  if (trimmed.includes('=')) {
    const chaves = trimmed
      .split('&')
      .map((part) => part.split('=')[0] ?? '')
      .filter(Boolean)
      .slice(0, 30);
    return { formato: 'FORM', chaves: Array.from(new Set(chaves)) };
  }
  return { formato: 'DESCONHECIDO', chaves: [] };
}

const FAILURE_TOKENS = ['redirect_to_upselling', 'bucket_lead', 'not_interacted', 'denied'] as const;

function captureSignals(sample: NetworkSample | undefined): { sucesso: string[]; falha: string[] } {
  if (!sample) return { sucesso: [], falha: [] };
  const body = (sample.responseBody ?? '').toLowerCase();
  const falha: string[] = [];
  for (const token of FAILURE_TOKENS) {
    if (body.includes(token)) falha.push(token);
  }
  const sucesso: string[] = [];
  if (isSuccessStatus(sample.status) && falha.length === 0) {
    sucesso.push('http_2xx_sem_erro');
    if (body.trim() === '' || body.trim() === '{}') sucesso.push('resposta_vazia');
  }
  return { sucesso, falha };
}

function captureScriptOf(dom: DomSample[]): CaptureScriptEvidence | undefined {
  return latestDom(dom.filter((sample) => sample.captureScript))?.captureScript;
}

function captureContract(network: NetworkSample[], dom: DomSample[]): CaptureContract | null {
  const captures = network.filter((sample) => isBucketCapturePath(pathOf(sample.url)));
  const gets = captures.filter((sample) => sample.method.toUpperCase() === 'GET');
  const posts = captures.filter((sample) => sample.method.toUpperCase() === 'POST');
  const post = latest(posts);
  const sample = post ?? latest(gets);
  const script = captureScriptOf(dom);

  if (captures.length === 0 && !script) return null;

  const payload = payloadFormat(post?.requestBody);
  const csrfHeaders = Array.from(
    new Set(
      posts.flatMap((item) =>
        Object.keys(item.requestHeaders ?? {}).filter((key) => /csrf|authenticity_token/i.test(key)),
      ),
    ),
  ).slice(0, 10);

  const postConfirmado = posts.some((item) => isSuccessStatus(item.status));

  const sucesso: string[] = [];
  const falha: string[] = [];
  if (post) {
    const signals = captureSignals(post);
    sucesso.push(...signals.sucesso);
    falha.push(...signals.falha);
  } else if (script) {
    if (script.navegacaoSucesso) sucesso.push('navegacao_para_webapp_leads');
    if (script.sinalUpselling) falha.push(script.sinalUpselling);
  }

  const statusObservados = Array.from(
    new Set([...posts, ...gets].map((item) => item.status).filter((status): status is number => status !== undefined)),
  ).slice(0, 10);

  const confianca: ContractConfidence = postConfirmado
    ? 'ALTA'
    : posts.length > 0 || script
      ? 'MEDIA'
      : 'BAIXA';

  const origem: ContractOrigin = posts.length > 0 ? 'REDE' : script ? 'SCRIPT' : captures.length > 0 ? 'REDE' : 'AUSENTE';

  const caminho =
    (sample ? pathOf(sample.url).replace(/\/\d+$/, '/{id}') : '') || script?.caminho || '/bucket_leads/{id}';

  const evidencia: ContractEvidence =
    captures.length > 0 ? evidenceOf(captures) : { amostras: dom.filter((item) => item.captureScript).length };

  return {
    metodoAprovacao: 'POST',
    caminho,
    getObservado: gets.length > 0 || script?.metodoGetPreChecagem === true,
    postObservado: posts.length > 0,
    postConfirmado,
    origem,
    formatoPayload: payload.formato,
    chavesPayload: payload.chaves,
    headersCsrf: csrfHeaders,
    sinaisSucesso: sucesso,
    sinaisFalha: falha,
    statusObservados,
    confianca,
    evidencia,
  };
}

function gateContract(dom: DomSample[], selectors: SelectorProfile[]): InteractionGateContract {
  const modalSelectors = new Set<string>();
  let modalObservado = false;
  let freeTierBloqueado = false;
  let freeTierValor: InteractionGateContract['freeTierValor'] = 'ausente';

  for (const sample of dom) {
    if (/id\s*=\s*["']modal_bucket_lead_not_interacted["']/i.test(sample.html)) {
      modalObservado = true;
      modalSelectors.add('#modal_bucket_lead_not_interacted');
    }
    if (/id\s*=\s*["']modal-whatsapp-not-interaction["']/i.test(sample.html)) {
      modalObservado = true;
      modalSelectors.add('#modal-whatsapp-not-interaction');
    }

    // O gate real é o VALOR do input (`== "true"` no JS do C2S), não a presença do elemento.
    const valor =
      /id\s*=\s*["']free_tier_enabled["'][^>]*\bvalue\s*=\s*["']([^"']+)["']/i.exec(sample.html)?.[1] ??
      /\bvalue\s*=\s*["']([^"']+)["'][^>]*\bid\s*=\s*["']free_tier_enabled["']/i.exec(sample.html)?.[1];
    if (valor !== undefined) {
      const normalizado = valor.trim().toLowerCase() === 'true' ? 'true' : 'false';
      freeTierValor = normalizado;
      if (normalizado === 'true') freeTierBloqueado = true;
    }

    if (/class\s*=\s*["'][^"']*\bfree_tier_limit_reached\b/i.test(sample.html)) {
      freeTierBloqueado = true;
    }
  }

  for (const profile of selectors) {
    for (const candidate of profile.candidates) {
      if (candidate.matches <= 0) continue;
      if (candidate.concept === 'bucketNotInteractedModal') {
        modalObservado = true;
        modalSelectors.add(candidate.selector);
      }
      // Modal de free tier existe oculto em toda página: só bloqueia se estiver visível.
      if (
        (candidate.concept === 'bucketFreeTierModal' || candidate.concept === 'bucketLimitReached') &&
        candidate.visiveis > 0
      ) {
        freeTierBloqueado = true;
      }
    }
  }

  const confianca: ContractConfidence = dom.length > 0 ? 'ALTA' : selectors.length > 0 ? 'MEDIA' : 'AUSENTE';

  return {
    modalObservado,
    modalSelectors: Array.from(modalSelectors).slice(0, 10),
    freeTierBloqueado,
    freeTierValor,
    amostrasDom: dom.length,
    confianca,
  };
}

function selectorConfidence(candidate: { matches: number; visiveis: number }): ContractConfidence {
  if (candidate.matches <= 0) return 'AUSENTE';
  return candidate.visiveis > 0 ? 'ALTA' : 'MEDIA';
}

function selectorContract(selectors: SelectorProfile[]): SelectorContract {
  const entries: SelectorContract['entradas'] = [];
  const faltando: string[] = [];

  for (const concept of AUTOMATION_CONCEPTS as SelectorConcept[]) {
    const candidates = selectors.flatMap((profile) =>
      profile.candidates.filter((candidate) => candidate.concept === concept),
    );
    const best = candidates
      .filter((candidate) => candidate.matches > 0)
      .sort((a, b) => b.score - a.score || b.matches - a.matches)[0];

    if (!best) {
      faltando.push(concept);
      continue;
    }

    entries.push({
      conceito: concept,
      seletor: best.selector,
      matches: best.matches,
      visiveis: best.visiveis,
      confianca: selectorConfidence(best),
    });
  }

  return { entradas: entries, faltando };
}

/**
 * Infere o contrato de captura do C2S a partir das amostras reais.
 *
 * Regras de segurança:
 *  - não inventa endpoint, payload, header ou seletor;
 *  - só reporta o que foi observado, com contagem de evidência e confiança;
 *  - sinais de sucesso/falha vêm de tokens fixos, sem copiar texto livre (PII).
 */
export function analyzeCalibrationContract(input: {
  network: NetworkSample[];
  dom: DomSample[];
  selectors: SelectorProfile[];
  geradoEm?: string;
}): CalibrationContract {
  const bucketList = bucketListContract(input.network, input.dom);
  const capture = captureContract(input.network, input.dom);
  const gate = gateContract(input.dom, input.selectors);
  const seletores = selectorContract(input.selectors);

  const conflitos: string[] = [];
  const listPaths = new Set(
    input.network
      .filter((sample) => sample.endpointType === 'BUCKET_LEADS' && isBucketListPath(pathOf(sample.url)))
      .map((sample) => pathOf(sample.url)),
  );
  if (listPaths.size > 1) {
    conflitos.push(`Mais de um caminho de lista do Bolsão: ${Array.from(listPaths).join(', ')}.`);
  }

  const capturePaths = new Set(
    input.network
      .filter((sample) => isBucketCapturePath(pathOf(sample.url)))
      .map((sample) => pathOf(sample.url).replace(/\/\d+$/, '/{id}')),
  );
  if (capturePaths.size > 1) {
    conflitos.push(`Mais de um caminho de captura: ${Array.from(capturePaths).join(', ')}.`);
  }

  const listFormats = new Set(
    input.network
      .filter((sample) => sample.endpointType === 'BUCKET_LEADS' && isBucketListPath(pathOf(sample.url)))
      .map((sample) => parseBody(sample.responseBody).kind)
      .filter((kind) => kind !== 'VAZIO' && kind !== 'DESCONHECIDO'),
  );
  if (listFormats.size > 1) {
    conflitos.push(`Formatos diferentes na lista do Bolsão: ${Array.from(listFormats).join(', ')}.`);
  }

  const pendencias: string[] = [];
  if (!bucketList) {
    pendencias.push('Nenhuma resposta 2xx nem estrutura DOM de /webapp/bucket_leads.');
  } else if (bucketList.origem === 'REDE' && (bucketList.formato !== 'JSON' || bucketList.chavesItem.length === 0)) {
    pendencias.push('Lista do Bolsão capturada sem itens reconhecíveis; confirmar com pelo menos 1 lead visível.');
  } else if (bucketList.origem === 'DOM' && (bucketList.totalNoPool ?? 0) === 0) {
    pendencias.push(
      'Bolsão vazio nas amostras: a estrutura do pool foi vista, mas os itens do card só se confirmam quando houver lead.',
    );
  }

  if (!capture) {
    pendencias.push('Captura não observada: nem rede em /bucket_leads/{id} nem script takeLeadToMe.');
  } else {
    if (!capture.getObservado) {
      pendencias.push('GET /bucket_leads/{id} não observado (pré-checagem do clique).');
    }
    if (!capture.postConfirmado) {
      pendencias.push(
        capture.postObservado
          ? 'POST /bucket_leads/{id} observado sem 2xx; confirmar o status real da captura.'
          : 'POST /bucket_leads/{id} a confirmar na primeira captura real (contrato derivado do script da página).',
      );
    }
    if (capture.postObservado && capture.headersCsrf.length === 0) {
      pendencias.push('POST de captura sem header CSRF observado; confirmar se a proteção é só por cookie/sessão.');
    }
    if (capture.postObservado && capture.sinaisSucesso.length === 0 && capture.sinaisFalha.length === 0) {
      pendencias.push('Nenhum sinal de sucesso/falha reconhecido na resposta do POST.');
    }
    if (!capture.postObservado && captureScriptOf(input.dom)?.csrfMetaPresente) {
      pendencias.push(
        'Página expõe meta csrf-token: confirmar se o POST exige X-CSRF-Token. A captura por clique usa a requisição do próprio C2S, que já envia o header.',
      );
    }
  }

  if (input.dom.length === 0) {
    pendencias.push('Nenhuma amostra de DOM; não é possível confirmar o gate #modal_bucket_lead_not_interacted.');
  }
  if (input.selectors.length === 0) {
    pendencias.push('Nenhum perfil de seletores; os seletores críticos continuam não validados.');
  }

  if (gate.freeTierValor === 'true') {
    pendencias.push('Free tier ativo (#free_tier_enabled = true): o C2S bloqueia a captura até liberar o Bolsão.');
  }

  if (gate.modalObservado) {
    pendencias.push(
      'Gate client-side observado (#modal_bucket_lead_not_interacted): a captura fica bloqueada até a interação. Confirmar em conta de teste qual ação limpa o gate.',
    );
  }

  return {
    geradoEm: input.geradoEm ?? nowIso(),
    totalAmostras: {
      rede: input.network.length,
      dom: input.dom.length,
      seletores: input.selectors.length,
    },
    bucketList,
    capture,
    gate,
    seletores,
    conflitos,
    pendencias,
  };
}
