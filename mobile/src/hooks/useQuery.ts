import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

/** Runs a database read and re-runs it every time the screen comes back into
 *  focus - which is what makes an order saved on another screen show up here
 *  without any store or cache to keep in sync. */
export function useQuery<T>(
  run: () => Promise<T>,
  deps: readonly unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A screen can unmount while its query is still in flight; setting state
  // then is a leak warning and, worse, a stale render.
  const alive = useRef(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runner = useCallback(run, deps);

  const load = useCallback(async () => {
    try {
      const result = await runner();
      if (alive.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [runner]);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  return { data, loading, error, reload: () => void load() };
}
