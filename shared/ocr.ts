export type OcrOptions = {
  language: "chi_sim+eng" | "chi_sim" | "eng";
  layout: "auto" | "block" | "sparse";
};
export type OcrJob = {
  id: string;
  status: "running" | "complete" | "cancelled" | "failed";
  text: string;
  error: string | null;
  elapsedMs: number;
  width?: number;
  height?: number;
};
