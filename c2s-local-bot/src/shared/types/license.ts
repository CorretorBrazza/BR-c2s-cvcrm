export interface LicenseFeatures {
  bucketCapture: boolean;
  autoStatus: boolean;
  autoActivity: boolean;
  autoMessage: boolean;
  metrics: boolean;
}

export type LicensePlan = 'trial' | 'pro' | 'enterprise';

/** Payload assinado (o que fica dentro do .lic, em base64). */
export interface LicensePayload {
  customer: string;
  plan: LicensePlan;
  features: LicenseFeatures;
  issuedAt: string;
  expiresAt: string;
  licenseId: string;
}

/**
 * Formato do arquivo .lic:
 * {
 *   "payload": "<base64 do JSON de LicensePayload>",
 *   "signature": "<base64 da assinatura Ed25519 do texto do payload>",
 *   "alg": "Ed25519",
 *   "keyId": "<id opcional da chave publica>"
 * }
 */
export interface SignedLicense {
  payload: string;
  signature: string;
  alg: 'Ed25519';
  keyId?: string;
}

export type LicenseStatus =
  | 'NAO_CONFIGURADA'
  | 'VALIDA'
  | 'EXPIRADA'
  | 'INVALIDA'
  | 'TOLERANCIA_OFFLINE';

export interface LicenseState {
  status: LicenseStatus;
  payload?: LicensePayload;
  motivo?: string;
  verificadoEm?: string;
  validoAte?: string;
  toleranciaAte?: string;
  origem: 'OFFLINE' | 'SERVIDOR' | 'NENHUMA';
}
