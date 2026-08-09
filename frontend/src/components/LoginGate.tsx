import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setAdminToken, clearAdminToken, getProviders, AuthError } from "@/lib/api";
import { Activity, Shield } from "lucide-react";

interface Props {
  onAuthed: () => void;
  onFail?: () => void;
}

/** 管理密码登录门：提交密码 → 存 token → 调一次受保护接口验证。 */
export default function LoginGate({ onAuthed, onFail }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!password) return;
    setSubmitting(true);
    setError("");
    setAdminToken(password);
    try {
      await getProviders(); // 受保护接口，401 抛 AuthError
      onAuthed();
    } catch (e) {
      clearAdminToken();
      onFail?.();
      setError(e instanceof AuthError ? "密码错误" : "无法连接服务，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm border-0 bg-card/50">
        <CardContent className="p-8 space-y-5">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold tracking-tight">Token Speed</h1>
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                <Shield className="w-3 h-3" /> 需要管理密码
              </p>
            </div>
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              type="password"
              autoFocus
              placeholder="管理密码"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={!password || submitting}>
              {submitting ? "验证中…" : "进入"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
