import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DataQuery } from '../../shared/types/messages';
import { panelApi } from '../lib/panelApi';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Consulta o service worker e mantém o resultado.
 * A chave é o JSON da consulta: evita loop de requisições por identidade de objeto.
 */
export function usePanelQuery<T>(query: DataQuery, options: { autoRefreshMs?: number } = {}): QueryState<T> {
  const key = useMemo(() => JSON.stringify(query), [query]);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    panelApi
      .query<T>(JSON.parse(key) as DataQuery)
      .then((result) => {
        if (!alive.current) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive.current) return;
        setError(cause instanceof Error ? cause.message : 'Falha ao consultar.');
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, [key, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!options.autoRefreshMs) return;
    const timer = window.setInterval(refresh, options.autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [options.autoRefreshMs, refresh]);

  return { data, loading, error, refresh };
}
