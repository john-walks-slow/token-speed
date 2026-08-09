import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "@/lib/theme";

// 同步应用保存的主题，在 React 首次 paint 前执行，避免首屏闪烁；返回 cleanup 供卸载
const cleanupTheme = initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// SPA 生命周期内通常不卸载；保留 cleanup 引用避免 lint 告警
void cleanupTheme;
