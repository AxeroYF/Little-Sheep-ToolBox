import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  cacheDir: "./runtime/vite",
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4328" },
  },
  build: { outDir: "dist", sourcemap: false },
});
