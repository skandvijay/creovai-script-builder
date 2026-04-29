import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In production on Vercel, /api/* is routed to the serverless functions in
// frontend/api/ automatically — no rewrites needed.
// In local dev, Vite proxies /api/* to the Express backend on VITE_API_BASE_URL
// so the same fetch("/api/messages") call works in both environments.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_BASE_URL || "http://localhost:3001";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
    },
  };
});
