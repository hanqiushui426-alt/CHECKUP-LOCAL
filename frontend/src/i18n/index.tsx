import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import zhCN from "./zh-CN";
import enUS from "./en-US";

export type Lang = "zh-CN" | "en-US";

const DICTS: Record<Lang, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};
export const LANGS: { code: Lang; label: string }[] = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en-US", label: "English" },
];

const STORAGE_KEY = "checkup.lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch {
    /* localStorage 不可用时忽略 */
  }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "zh-CN";
  return String(nav).toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nCtx = createContext<I18nValue>({
  lang: "zh-CN",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = DICTS[lang]?.[key] ?? DICTS["zh-CN"]?.[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split(`{${k}}`).join(String(v));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nCtx);
}
