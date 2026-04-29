import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// During `vite dev` we proxy /api → VITE_API_BASE_URL so the frontend can call
// "/api/messages" without CORS gymnastics. In production on Vercel, the rewrite
// in vercel.json sends /api/* to the Express function and no proxy is needed.
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
