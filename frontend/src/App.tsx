import { useEffect, useState } from "react";
import FullApp from "./FullApp";
import DashboardApp from "./DashboardApp";
import LoginGate from "./components/LoginGate";
import { getAuthStatus, getAdminToken, setAdminToken, clearAdminToken, getProviders } from "@/lib/api";
import { Activity } from "lucide-react";

type View = "loading" | "full" | "dashboard" | "login";

export default function App() {
  const [view, setView] = useState<View>("loading");

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

    getAuthStatus()
      .then((s) => {
        // 未配置密码 → 直接完整界面（向后兼容）
        if (!s.required) return setView("full");
        // 已配置密码：有 token 则校验一次；无 token → 匿名只读统计视图
        if (!getAdminToken()) return setView("dashboard");
        getProviders()
          .then(() => setView("full"))
          .catch(() => {
            clearAdminToken();
            setView("dashboard");
          });
      })
      .catch(() => setView("full"));
  }, []);

  if (view === "loading") {
    return (
      <div className="h-screen flex items-center justify-center">
        <Activity className="w-6 h-6 animate-pulse text-primary" />
      </div>
    );
  }

  // 匿名只读统计视图（配置了密码但未登录）
  if (view === "dashboard") {
    return (
      <DashboardApp
        onLoginForAdmin={() => setView("login")}
      />
    );
  }

  // 管理登录门（输入密码验证）
  if (view === "login") {
    return (
      <LoginGate
        onAuthed={() => {
          setView("full");
        }}
        onFail={() => {
          clearAdminToken();
          setView("dashboard");
        }}
      />
    );
  }

  return <FullApp />;
}