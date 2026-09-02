import { useEffect, useRef } from "react";

const refreshIntervalMs = 15_000;
const foregroundDedupeMs = 1_000;

export function useVisibleAutoRefresh(
  refresh: () => void | Promise<void>,
  enabled = true
) {
  const refreshRef = useRef(refresh);
  const runningRef = useRef(false);
  const lastStartedAtRef = useRef(0);

  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;

    let intervalId: number | undefined;

    const runRefresh = async (dedupeForegroundEvent = false) => {
      if (document.hidden || runningRef.current) return;

      const startedAt = Date.now();
      if (
        dedupeForegroundEvent &&
        startedAt - lastStartedAtRef.current < foregroundDedupeMs
      ) {
        return;
      }

      runningRef.current = true;
      lastStartedAtRef.current = startedAt;
      try {
        await refreshRef.current();
      } catch {
        // Silent refresh failures leave the current screen data intact.
      } finally {
        runningRef.current = false;
      }
    };

    const stopInterval = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const startInterval = () => {
      stopInterval();
      if (!document.hidden) {
        intervalId = window.setInterval(() => void runRefresh(), refreshIntervalMs);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopInterval();
        return;
      }

      startInterval();
      void runRefresh(true);
    };

    const handleFocus = () => void runRefresh(true);

    startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled]);
}
