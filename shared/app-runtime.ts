export type AppRuntime = {
  state:
    | "running"
    | "stopped"
    | "starting"
    | "closing"
    | "unknown"
    | "embedded";
  instances: number;
  since: number | null;
  canClose: boolean;
  canShow: boolean;
};
