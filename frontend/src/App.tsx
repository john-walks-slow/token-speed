import { useEffect, useState } from "react";
import FullApp from "./FullApp";
import DashboardApp from "./DashboardApp";
import LoginGate from "./components/LoginGate";
import { getMode, getAuthStatus, getAdminToken, setAdminToken, clearAdminToken, getProviders } from "@/lib/api";
import { Activity } from "lucide-react";

type View = "loading" | "full" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // 桌面壳通过 URL ?admin_password=<pw> 自动注入管理密码（一次性，随后清理）
    const params = new URLSearchParams(window.location.search);
    const injected = params.get("admin_password");
    if (injected) {
      setAdminToken(injected);
      params.delete("admin_password");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname + window.location.hash);
    }

    getMode()
      .then((m) => setView(m.mode === "dashboard" ? "dashboard" : "full"))
      .catch(() => setView("full"));
    getAuthStatus()
      .then((s) => {
        // 已配置密码且带 token：额外调一次受保护接口校验有效性（密码可能已被修改）
        if (!s.required) return setAuthed(true);
        if (!getAdminToken()) return setAuthed(false);
        getProviders()
          .then(() => setAuthed(true))
          .catch(() => {
            clearAdminToken();
            setAuthed(false);
          });
      })
      .catch(() => setAuthed(true));
  }, []);

  if (view === "loading") {
    return (
      <div className="h-screen flex items-center justify-center">
        <Activity className="w-6 h-6 animate-pulse text-primary" />
      </div>
    );
  }

  if (view === "dashboard") {
    return <DashboardApp />;
  }

  if (!authed) {
    return (
      <LoginGate
        onAuthed={() => setAuthed(true)}
        onFail={() => clearAdminToken()}
      />
    );
  }

  return <FullApp />;
}
