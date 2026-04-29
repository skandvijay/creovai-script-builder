import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// During `vite dev` we proxy /_/backend/* → VITE_API_BASE_URL so the frontend
// can call "/_/backend/api/messages" without CORS gymnastics. The prefix is
// stripped so the Express app receives "/api/messages" directly — matching
// what Vercel's experimentalServices router does in staging/production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_BASE_URL || "http://localhost:3001";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/_/backend": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/_\/backend/, ""),
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
    },
  };
});
