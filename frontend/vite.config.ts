import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api and /uploads to the Express backend so the
// frontend can use same-origin relative URLs (no CORS headaches in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/uploads": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
