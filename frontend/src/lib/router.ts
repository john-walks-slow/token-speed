/** 极简 hash 路由：`#/test`、`#/results` 等，支持前进/后退与刷新保持。

约定：hash 形如 "#/<tab>"，非法值回落 defaultTab。无 react-router 依赖。
主应用（full）5 个 Tab；看板（dashboard）仅 stats/results。
 */
import { useEffect, useState } from "react";

export function useHashRoute(
  valid: string[],
  defaultTab: string
): [string, (v: string) => void] {
  const validSet = new Set(valid);

  function readHash(): string {
    const raw = window.location.hash.replace(/^#\/?/, "");
    return validSet.has(raw) ? raw : defaultTab;
  }

  const [route, setRoute] = useState(readHash);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid.join(","), defaultTab]);

  const navigate = (v: string) => {
    if (validSet.has(v) && v !== readHash()) {
      window.location.hash = `/${v}`;
    }
  };

  return [route, navigate];
}
