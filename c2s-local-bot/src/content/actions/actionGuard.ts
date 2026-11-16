/**
 * Compatibilidade: o guard vive em `shared/analysis` (lógica pura).
 * Reexportado aqui para não quebrar imports do content script.
 */
export {
  evaluateAction,
  isInteractionEvidence,
  type GuardContext,
  type GuardDecision,
  type GuardedAction,
} from '../../shared/analysis/actionGuard';
