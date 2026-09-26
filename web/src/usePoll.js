import { useEffect, useRef, useState } from 'react';

// Fetch `load` now and every `ms` while `active(data)` is true.
// `refresh()` fetches immediately and restarts polling if it had stopped.
export default function usePoll(load, active, ms = 1500, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const d = await load();
        if (stop) return;
        setData(d);
        setError(null);
        if (activeRef.current(d)) timer = setTimeout(tick, ms);
      } catch (err) {
        if (!stop) {
          setError(err.message);
          timer = setTimeout(tick, ms * 3);
        }
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [...deps, nonce]);

  const refresh = () => setNonce((n) => n + 1);
  return [data, setData, refresh, error];
}
