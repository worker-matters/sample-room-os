import { sampleTypeOptions as fallbackOptions } from "@sample-room/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { sampleRoomApi, type SampleTypeOption } from "../api/sampleRoomApi";
import type { DevSession } from "./DevSessionContext";

type SampleTypeOptionsValue = {
  options: SampleTypeOption[];
  loading: boolean;
  reload: () => Promise<SampleTypeOption[]>;
  setOptions: (options: SampleTypeOption[]) => void;
  labelFor: (code: string | undefined | null) => string;
};

const fallback: SampleTypeOption[] = fallbackOptions.map((item) => ({ ...item }));
const SampleTypeOptionsContext = createContext<SampleTypeOptionsValue | undefined>(undefined);

export function SampleTypeOptionsProvider({ session, children }: { session: DevSession; children: ReactNode }) {
  const [options, setOptions] = useState<SampleTypeOption[]>(fallback);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await sampleRoomApi.listSampleTypeOptions(session);
      setOptions(response.items);
      return response.items;
    } catch {
      setOptions(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<SampleTypeOptionsValue>(() => ({
    options,
    loading,
    reload,
    setOptions,
    labelFor: (code) => {
      if (!code) return "-";
      return options.find((item) => item.value === code)?.label ?? `未知类型（${code}）`;
    }
  }), [loading, options, reload]);

  return <SampleTypeOptionsContext.Provider value={value}>{children}</SampleTypeOptionsContext.Provider>;
}

export function useSampleTypeOptions() {
  const value = useContext(SampleTypeOptionsContext);
  if (!value) throw new Error("useSampleTypeOptions must be used within SampleTypeOptionsProvider");
  return value;
}
