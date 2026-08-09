import type { Provider } from "@/types";

/** 取一个记录对应的 provider 标识 key。
 *
 * 优先用 provider_id；否则尝试按 base_url hostname 匹配目录里的 provider，
 * 命中则归入其 id（legacy 记录也能和 catalog 组对齐，避免幽灵重复组）；
 * 都不行才回退到 hostname。
 */
export function recordProviderKey(
  providers: Provider[],
  rec: {
    provider_id?: string | null;
    base_url?: string;
  }
): string {
  if (rec.provider_id) return rec.provider_id;
  const host = hostnameFromUrl(rec.base_url);
  if (host !== "unknown") {
    const p = providers.find((x) => hostnameFromUrl(x.base_url) === host);
    if (p) return p.id;
  }
  return host;
}

/** `${providerKey}|${model}`，与 ModelSelector 的组 key 格式一致。 */
export function recordKey(
  providers: Provider[],
  rec: {
    provider_id?: string | null;
    base_url?: string;
    model: string;
  }
): string {
  return `${recordProviderKey(providers, rec)}|${rec.model}`;
}

/** 从 URL 取 hostname，兜底原值 / "unknown"。 */
export function hostnameFromUrl(url?: string): string {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return url;
  }
}

/** 解析记录所属 provider 的展示名：目录最新名 → 插入时快照 → hostname → unknown。 */
export function resolveProviderName(
  providers: Provider[],
  rec: {
    provider_id?: string | null;
    provider_name?: string | null;
    base_url?: string;
  }
): string {
  if (rec.provider_id) {
    const p = providers.find((x) => x.id === rec.provider_id);
    if (p) return p.name;
  }
  return rec.provider_name || hostnameFromUrl(rec.base_url);
}

/** 某 modelid 是否被多家 provider 提供（按当前目录判断）。 */
export function isModelAmbiguous(providers: Provider[], model: string): boolean {
  return providers.filter((p) => p.models?.includes(model)).length > 1;
}

/** 模型展示名：ambiguous 时带 (provider名)，否则就模型名本身。 */
export function modelDisplayLabel(
  providers: Provider[],
  rec: {
    model: string;
    provider_id?: string | null;
    provider_name?: string | null;
    base_url?: string;
  }
): string {
  if (isModelAmbiguous(providers, rec.model)) {
    return `${rec.model} (${resolveProviderName(providers, rec)})`;
  }
  return rec.model;
}
