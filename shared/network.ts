export type TestKind = "speed" | "ping" | "dns" | "tcp" | "trace";
export const SPEED_PHASE_MS = 15000;
export const SPEED_SAMPLE_MS = 1000;
export interface Probe {
  index: number;
  address: string | null;
  status: string;
  ms: number | null;
}
export interface NetworkResult {
  target: string;
  port?: number;
  samples?: Probe[];
  sent?: number;
  received?: number;
  latencyMs?: number | null;
  jitterMs?: number | null;
  lossPercent?: number | null;
  minMs?: number | null;
  maxMs?: number | null;
  addresses?: string[];
  dnsMs?: number;
  downloadMbps?: number;
  uploadMbps?: number;
  downloadPeakMbps?: number;
  uploadPeakMbps?: number;
  phaseDurationMs?: number;
  phaseElapsedMs?: number;
  downloadDurationMs?: number;
  uploadDurationMs?: number;
  downloadedBytes?: number;
  uploadedBytes?: number;
  endpoint?: string;
  mode?: string;
  reached?: boolean;
  nodeId?: string;
  nodeName?: string;
  speedSamples?: SpeedSample[];
  liveMbps?: number;
  activeDirection?: "download" | "upload";
  transferRoute?: string;
}
export interface SpeedSample { elapsedMs: number; phaseElapsedMs?: number; direction: "download" | "upload"; mbps: number; bytes: number }
export interface SpeedNode { id: string; name: string; region: string; host: string; download: boolean; upload: boolean }
export interface AdapterInfo {
  name: string; description?: string; type?: string; speedMbps?: number;
  addresses: string[]; gateways: string[]; dns: string[]; tunnelSuspected?: boolean;
}
export interface LocalNetworkInfo {
  adapters: AdapterInfo[];
  proxy: { enabled: boolean | null; server?: string; pacConfigured?: boolean; error?: string };
  dns: string[];
  error?: string;
}
export interface PublicRoute {
  ip?: string; family?: string; location?: string; organization?: string; asn?: string; timezone?: string;
  source?: string; viaProxy?: boolean | null; proxyAddress?: string; error?: string;
}
export interface NetworkIdentity {
  checkedAt: number; direct: PublicRoute; system: PublicRoute;
  proxyStatus: "confirmed" | "configured" | "tunnel" | "not-detected" | "unknown";
  proxyLabel: string;
}
export interface NetworkInfo extends LocalNetworkInfo { nodes: SpeedNode[]; defaultNode: string }
export interface NetworkJob {
  id: string;
  kind: TestKind;
  status: "running" | "complete" | "failed" | "cancelled";
  phase: string;
  progress: number;
  startedAt: number;
  finishedAt?: number;
  result: NetworkResult;
  error?: string;
}
