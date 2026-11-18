import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data and tracks loading/error state. Ignores responses that arrive after unmount or after a
 * newer request started, so a slow response can never overwrite fresher data.
 */
export function useFetch(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = (latest.current += 1);
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (id === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === latest.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    return () => {
      latest.current += 1; // invalidate in-flight requests on unmount
    };
  }, [load]);

  return { ...state, reload: load };
}
