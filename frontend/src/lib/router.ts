/** 极简 hash 路由：`#/test`、`#/results` 等，支持前进/后退与刷新保持。

约定：hash 形如 "#/<tab>"，非法值回落 "#/test"。无 react-router 依赖。
 */
import { useEffect, useState } from "react";

const VALID = new Set(["test", "results", "stats", "schedule", "settings"]);

function readHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return VALID.has(raw) ? raw : "test";
}

export function useHashRoute(): [string, (v: string) => void] {
  const [route, setRoute] = useState(readHash);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (v: string) => {
    if (VALID.has(v) && v !== readHash()) {
      window.location.hash = `/${v}`;
    }
  };

  return [route, navigate];
}
