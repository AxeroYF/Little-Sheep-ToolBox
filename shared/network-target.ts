export const NETWORK_TARGET_ERROR = "请输入有效的域名、IP 或 http(s) 网址";

export interface NetworkTarget {
  host: string;
  port?: number;
}

// Only the host and optional port reach the probe. Paths, queries and fragments
// are never requested or persisted in network reports.
export function parseNetworkTarget(input: string): NetworkTarget {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(value))
    throw new Error(NETWORK_TARGET_ERROR);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value))
    throw new Error(NETWORK_TARGET_ERROR);
  // URL requires brackets around IPv6; accept a bare IPv6 address too.
  const bareIPv6 = !/[\[\]/?#]/.test(value) && (value.match(/:/g)?.length ?? 0) > 1;
  const source = hasScheme ? value : value.startsWith("//") ? "http:" + value
    : "http://" + (bareIPv6 ? `[${value}]` : value);
  const authority = source.slice(source.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  // Do not silently reinterpret credentials or malformed authorities as hosts.
  if (!authority || authority.includes("@") || authority.endsWith(":"))
    throw new Error(NETWORK_TARGET_ERROR);
  let url: URL;
  try { url = new URL(source); }
  catch { throw new Error(NETWORK_TARGET_ERROR); }
  const ipv6 = url.hostname.startsWith("[") && url.hostname.endsWith("]");
  const host = ipv6 ? url.hostname.slice(1, -1) : url.hostname.replace(/\.$/, "");
  if (!host || (!ipv6 && (host.length > 253 || !host.split(".").every(part =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part)))))
    throw new Error(NETWORK_TARGET_ERROR);
  // URL removes a protocol's default port, so also inspect the authority for
  // explicitly typed :80 on a scheme-less address.
  const explicitPort = authority.match(/:(\d+)$/)?.[1];
  const port = explicitPort ? Number(explicitPort) : hasScheme ? (url.protocol === "https:" ? 443 : 80) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error(NETWORK_TARGET_ERROR);
  return port === undefined ? { host } : { host, port };
}
