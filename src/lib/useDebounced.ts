import { useEffect, useState } from 'react';

/** Valor que só muda depois de `delay` ms sem novas alterações (ex.: busca enquanto digita). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
