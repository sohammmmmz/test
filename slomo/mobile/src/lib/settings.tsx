/**
 * Where the Jetson lives: backend origin + bearer token, persisted on device.
 * Screens render only after settings load so WS clients never dial the
 * wrong host first.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState } from "react";

export interface Settings {
  apiUrl: string;
  token: string;
}

const DEFAULTS: Settings = { apiUrl: "http://slomo.local:8000", token: "change-me" };
const KEY = "slomo.settings";

interface SettingsCtx extends Settings {
  save: (next: Settings) => Promise<void>;
}

const Ctx = createContext<SettingsCtx>({ ...DEFAULTS, save: async () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setSettings(raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS))
      .catch(() => setSettings(DEFAULTS));
  }, []);

  if (settings === null) return null;

  const save = async (next: Settings) => {
    setSettings(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  };

  return <Ctx.Provider value={{ ...settings, save }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  return useContext(Ctx);
}
