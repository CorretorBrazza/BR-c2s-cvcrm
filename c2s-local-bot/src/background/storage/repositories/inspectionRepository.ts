import { LIMITS } from '../../../shared/constants/limits';
import { computeCalibrationCounts } from '../../../shared/analysis/calibrationCounts';
import { analyzeCalibrationContract } from '../../../shared/analysis/contractAnalyzer';
import type {
  CalibrationCounts,
  CalibrationReadiness,
  DomSample,
  NetworkSample,
  PageContext,
  SelectorProfile,
} from '../../../shared/types/inspection';
import { nowIso } from '../../../shared/utils/dateUtils';
import { dbClear, dbDelete, dbGet, dbGetAll, dbPut } from '../indexedDb';
import type { CalibrationRow, InspectionSampleRow } from '../migrations';

export function emptyCounts(): CalibrationCounts {
  return {
    bucketListResponse: 0,
    leadsV2Response: 0,
    captureGet: 0,
    capturePost: 0,
    leadDetailPage: 0,
    contactsListPage: 0,
    bucketPage: 0,
    domSamples: 0,
    selectorProfiles: 0,
  };
}

const MINIMOS: CalibrationCounts = { ...LIMITS.calibrationMinSamples };

type Kind = InspectionSampleRow['kind'];

export class InspectionRepository {
  async addNetwork(samples: NetworkSample[]): Promise<void> {
    if (samples.length === 0) return;
    const rows: InspectionSampleRow[] = samples.map((sample) => ({
      id: sample.id,
      kind: 'network',
      endpointType: sample.endpointType,
      timestamp: sample.timestamp,
      payload: sample,
    }));
    for (const row of rows) await dbPut('inspection_samples', row);
  }

  async addDom(sample: DomSample): Promise<void> {
    await dbPut('inspection_samples', {
      id: sample.id,
      kind: 'dom',
      timestamp: sample.timestamp,
      payload: sample,
    });
  }

  async addSelectors(profile: SelectorProfile): Promise<void> {
    await dbPut('inspection_samples', {
      id: profile.id,
      kind: 'selectors',
      timestamp: profile.timestamp,
      payload: profile,
    });
  }

  async addScreenshot(id: string, timestamp: string, payload: unknown): Promise<void> {
    await dbPut('inspection_samples', { id, kind: 'screenshot', timestamp, payload });
  }

  async list(kind?: Kind, limit = 200): Promise<Array<NetworkSample | DomSample | SelectorProfile>> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    const filtered = kind ? rows.filter((row) => row.kind === kind) : rows;
    return filtered
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit)
      .map((row) => row.payload as NetworkSample | DomSample | SelectorProfile);
  }

  private async collect(): Promise<{
    network: NetworkSample[];
    dom: DomSample[];
    selectors: SelectorProfile[];
    counts: CalibrationCounts;
  }> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    const network: NetworkSample[] = [];
    const dom: DomSample[] = [];
    const selectors: SelectorProfile[] = [];

    for (const row of rows) {
      if (row.kind === 'network') network.push(row.payload as NetworkSample);
      if (row.kind === 'dom') dom.push(row.payload as DomSample);
      if (row.kind === 'selectors') selectors.push(row.payload as SelectorProfile);
    }

    return { network, dom, selectors, counts: computeCalibrationCounts({ network, dom, selectors }) };
  }

  async counts(): Promise<CalibrationCounts> {
    return (await this.collect()).counts;
  }

  async readiness(): Promise<CalibrationReadiness> {
    const { network, dom, selectors, counts } = await this.collect();
    const contract = analyzeCalibrationContract({ network, dom, selectors });
    const pendencias: string[] = [];
    const avisos: string[] = [];

    // Bloqueiam a confirmação: sem isso o robô não sabe onde nem como agir.
    if (counts.bucketPage < MINIMOS.bucketPage) pendencias.push('visita registrada à página do Bolsão');
    if (counts.domSamples < MINIMOS.domSamples) pendencias.push('amostras de DOM');
    if (counts.selectorProfiles < MINIMOS.selectorProfiles) pendencias.push('perfil de seletores');
    if (!contract.bucketList) pendencias.push('contrato da lista do Bolsão (rede ou DOM)');
    if (!contract.capture) pendencias.push('contrato de captura (rede ou script)');

    // Não bloqueiam: são confirmações que só a primeira captura real resolve.
    if (counts.captureGet < MINIMOS.captureGet) avisos.push('GET de captura ainda não observado');
    if (!contract.capture?.postConfirmado) avisos.push('POST de captura a confirmar na primeira captura real');
    if (counts.leadsV2Response < MINIMOS.leadsV2Response) avisos.push('resposta de /webapp/leads/v2 não observada');
    if (counts.leadDetailPage < MINIMOS.leadDetailPage) avisos.push('página de detalhe do lead não visitada');
    if (counts.contactsListPage < MINIMOS.contactsListPage) avisos.push('lista de contatos não visitada');
    if (contract.bucketList?.origem === 'DOM') avisos.push('lista do Bolsão derivada do DOM (sem resposta de rede)');
    if (contract.bucketList?.origem === 'DOM' && (contract.bucketList.totalNoPool ?? 0) === 0) {
      avisos.push('Bolsão vazio nas amostras: confirmar os itens quando houver lead');
    }

    const row = await dbGet<CalibrationRow>('calibration', 'current');
    return {
      counts,
      minimos: MINIMOS,
      pronto: pendencias.length === 0,
      pendencias,
      avisos,
      confirmedAt: row?.confirmedAt ?? '',
      appFingerprint: row?.appFingerprint ?? '',
    };
  }

  async confirm(appFingerprint: string): Promise<CalibrationReadiness> {
    const counts = await this.counts();
    const row: CalibrationRow = {
      id: 'current',
      counts,
      confirmedAt: nowIso(),
      appFingerprint,
      atualizadoEm: nowIso(),
    };
    await dbPut('calibration', row);
    return this.readiness();
  }

  async lastSampleAt(): Promise<string | undefined> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    if (rows.length === 0) return undefined;
    return rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0]?.timestamp;
  }

  async contextsSeen(): Promise<PageContext[]> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    const contexts = new Set<PageContext>();
    for (const row of rows) {
      if (row.kind === 'network') {
        const sample = row.payload as NetworkSample;
        if (sample.pageContext) contexts.add(sample.pageContext);
      }
      if (row.kind === 'dom') contexts.add((row.payload as DomSample).context);
    }
    return Array.from(contexts);
  }

  async deleteScreenshotsOlderThan(isoCutoff: string): Promise<number> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    let deleted = 0;
    for (const row of rows) {
      if (row.kind === 'screenshot' && row.timestamp < isoCutoff) {
        await dbDelete('inspection_samples', row.id);
        deleted++;
      }
    }
    return deleted;
  }

  async deleteScreenshotsBeyond(keep: number): Promise<void> {
    const rows = await dbGetAll<InspectionSampleRow>('inspection_samples');
    const shots = rows
      .filter((row) => row.kind === 'screenshot')
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    for (const row of shots.slice(Math.max(0, keep))) {
      await dbDelete('inspection_samples', row.id);
    }
  }

  async clear(): Promise<void> {
    await dbClear('inspection_samples');
    await dbDelete('calibration', 'current');
  }
}

export const inspectionRepository = new InspectionRepository();
