/** 深浅色主题：默认跟随系统，可强制 light/dark，localStorage 持久化。

约定：
- localStorage key "token-speed-theme"，值 "system" | "light" | "dark"
- 应用方式：html[data-theme] 属性，system 时不设属性（由 CSS @media 跟随系统）
- 系统主题变化时通过 matchMedia 监听实时更新
- index.html 内联脚本在 React 挂载前同步应用主题，消除 FOUC
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "token-speed-theme";

function applyTheme(mode: ThemeMode): void {
  const el = document.documentElement;
  if (mode === "system") {
    el.removeAttribute("data-theme");
  } else {
    el.setAttribute("data-theme", mode);
  }
}

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function getTheme(): ThemeMode {
  return readStored();
}

export function setTheme(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

/** 启动时应用已保存主题，并监听系统主题切换。返回 cleanup。 */
export function initTheme(): () => void {
  applyTheme(readStored());
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (readStored() === "system") {
      applyTheme("system");
    }
  };
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
