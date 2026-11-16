import { DEFAULT_SETTINGS } from '../../../shared/constants/defaults';
import { LIMITS } from '../../../shared/constants/limits';
import { CVRM_LIMITS } from '../../../shared/constants/cvcrm';
import { WINDOW_LIMITS } from '../../../shared/analysis/windowPolicy';
import type { Settings, SettingsPatch } from '../../../shared/types/settings';
import { nowIso } from '../../../shared/utils/dateUtils';
import { clamp } from '../../../shared/utils/validation';
import { dbBulkPut, dbGetAll } from '../indexedDb';
import type { SettingRow } from '../migrations';

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, min, max));
}

function text(value: unknown, fallback = '', maxLength = 2_000): string {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLength);
}

/** Normaliza qualquer entrada para um Settings válido. Nunca confia no painel. */
export function sanitizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };

  const poolMin = int(merged.poolDelayMinMs, LIMITS.poolDelayMinMs, 0, 60_000);
  const poolMax = int(merged.poolDelayMaxMs, LIMITS.poolDelayMaxMs, 0, 60_000);

  return {
    botActive: Boolean(merged.botActive),

    // Captura/automação: qualquer coisa diferente de `true` é `false`.
    autoClaimPool: merged.autoClaimPool === true,
    autoMoveToAttendance: merged.autoMoveToAttendance === true,
    autoCreateFollowUp: merged.autoCreateFollowUp === true,
    autoSendMessage: merged.autoSendMessage === true,

    poolDelayMinMs: Math.min(poolMin, poolMax),
    poolDelayMaxMs: Math.max(poolMin, poolMax),
    pollingIntervalMs: int(merged.pollingIntervalMs, LIMITS.pollingDefaultMs, LIMITS.pollingMinMs, LIMITS.pollingMaxMs),
    maxRetries: int(merged.maxRetries, LIMITS.maxRetries, 0, 10),
    duplicateProtectionHours: int(merged.duplicateProtectionHours, 12, 1, 24 * 7),

    inspectMode: merged.inspectMode !== false,
    inspectCaptureScreenshots: merged.inspectCaptureScreenshots !== false,
    inspectIncludePii: merged.inspectIncludePii === true,

    soundAlerts: merged.soundAlerts !== false,
    desktopNotifications: merged.desktopNotifications !== false,

    retentionTechnicalLogsDays: int(merged.retentionTechnicalLogsDays, LIMITS.retentionTechnicalLogsDays, 1, 365),
    retentionLeadDataDays: int(merged.retentionLeadDataDays, LIMITS.retentionLeadDataDays, 1, 730),
    retentionMetricsMonths: int(merged.retentionMetricsMonths, LIMITS.retentionMetricsMonths, 1, 60),
    retentionScreenshotsDays: int(merged.retentionScreenshotsDays, LIMITS.retentionScreenshotsDays, 1, 90),
    retentionScreenshotsMaxFiles: int(merged.retentionScreenshotsMaxFiles, LIMITS.retentionScreenshotsMaxFiles, 10, 2_000),

    licenseKey: text(merged.licenseKey, '', 8_000).trim(),
    licenseCheckIntervalHours: int(merged.licenseCheckIntervalHours, 6, 1, 168),
    offlineLicenseToleranceHours: int(merged.offlineLicenseToleranceHours, 48, 1, 168),

    targetAttendanceColumnId: text(merged.targetAttendanceColumnId, '', 64).trim(),
    targetAttendanceFunnelId: text(merged.targetAttendanceFunnelId, '', 64).trim(),

    followUpDelayHours: int(merged.followUpDelayHours, 24, 1, 24 * 30),
    followUpDescription: text(merged.followUpDescription, 'Retornar para o cliente', 200),

    templateDirect: text(merged.templateDirect, DEFAULT_SETTINGS.templateDirect, 4_000),
    templatePool: text(merged.templatePool, DEFAULT_SETTINGS.templatePool, 4_000),

    telemetryEnabled: merged.telemetryEnabled === true,

    calibrationConfirmedAt: text(merged.calibrationConfirmedAt, '', 40),
    calibrationAppFingerprint: text(merged.calibrationAppFingerprint, '', 200),

    poolWindowMinutes: int(merged.poolWindowMinutes, WINDOW_LIMITS.poolDefaultMinutes, WINDOW_LIMITS.poolMinMinutes, WINDOW_LIMITS.poolMaxMinutes),
    leadWindowMinutes: int(merged.leadWindowMinutes, WINDOW_LIMITS.leadDefaultMinutes, WINDOW_LIMITS.leadMinMinutes, WINDOW_LIMITS.leadMaxMinutes),
    bringTabToFront: merged.bringTabToFront !== false,
    automationOptInAt: text(merged.automationOptInAt, '', 40),

    cvcrmEnabled: merged.cvcrmEnabled === true,
    cvcrmAutoMove: merged.cvcrmAutoMove === true,
    cvcrmDelaySeconds: int(
      merged.cvcrmDelaySeconds,
      CVRM_LIMITS.delaySeconds.default,
      CVRM_LIMITS.delaySeconds.min,
      CVRM_LIMITS.delaySeconds.max,
    ),
    cvcrmMaxAgeHours: int(
      merged.cvcrmMaxAgeHours,
      CVRM_LIMITS.maxAgeHours.default,
      CVRM_LIMITS.maxAgeHours.min,
      CVRM_LIMITS.maxAgeHours.max,
    ),
    cvcrmDetection: merged.cvcrmDetection === 'KANBAN' ? 'KANBAN' : 'TOAST',
    cvcrmPollSeconds: int(
      merged.cvcrmPollSeconds,
      CVRM_LIMITS.pollSeconds.default,
      CVRM_LIMITS.pollSeconds.min,
      CVRM_LIMITS.pollSeconds.max,
    ),
    cvcrmHost: text(merged.cvcrmHost, '', 200).trim().toLowerCase(),
  };
}

class SettingsRepository {
  private cache: Settings | null = null;

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const rows = await dbGetAll<SettingRow>('settings');
    const patch: Record<string, unknown> = {};
    for (const row of rows) patch[row.chave] = row.valor;
    this.cache = sanitizeSettings(patch as Partial<Settings>);
    return this.cache;
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
    const current = await this.get();
    const next = sanitizeSettings({ ...current, ...patch });
    const atualizadoEm = nowIso();

    const rows: SettingRow[] = Object.entries(next).map(([chave, valor]) => ({
      chave,
      valor,
      atualizadoEm,
    }));

    await dbBulkPut('settings', rows);
    this.cache = next;
    return next;
  }

  async ensureDefaults(): Promise<Settings> {
    const rows = await dbGetAll<SettingRow>('settings');
    if (rows.length === 0) {
      return this.patch(DEFAULT_SETTINGS);
    }
    return this.get();
  }
}

export const settingsRepository = new SettingsRepository();
