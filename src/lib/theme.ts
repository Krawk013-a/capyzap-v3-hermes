"use client";

import { useEffect, useState } from "react";

const KEY = "capyzap-theme";

/** Tema light/dark persistente no localStorage. */
export function useTheme(): [string, (t: string) => void] {
  const [theme, setTheme] = useState<string>("light");

  useEffect(() => {
    let saved = "light";
    try {
      saved = localStorage.getItem(KEY) ?? "light";
    } catch {}
    setTheme(saved);
    document.documentElement.classList.toggle("dark", saved === "dark");
  }, []);

  const change = (t: string) => {
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  return [theme, change];
}
