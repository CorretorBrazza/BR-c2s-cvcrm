import { useCallback, useEffect, useState } from 'react';
import { PANEL_ROUTES } from '../../shared/constants/defaults';

const VALID = new Set<string>(PANEL_ROUTES.map((route) => route.path));
const FALLBACK = 'dashboard';

function readHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return VALID.has(raw) ? raw : FALLBACK;
}

export function useHashRoute(): { route: string; navigate: (path: string) => void } {
  const [route, setRoute] = useState<string>(readHash);

  useEffect(() => {
    const onChange = (): void => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.replace(`#/${FALLBACK}`);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    const target = VALID.has(path) ? path : FALLBACK;
    window.location.hash = `#/${target}`;
    setRoute(target);
  }, []);

  return { route, navigate };
}
