/* eslint-disable */
/**
 * Entry do MAIN world (document_start) para o CV CRM.
 *
 * Só instala o guard do `confirm` da página do lead. Não lê storage, não fala
 * com o service worker e não altera nada além do `window.confirm`.
 */
import { installConfirmGuard } from '../confirmGuard';

installConfirmGuard(window);
