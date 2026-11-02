import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) return "charts";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/motion")) return "motion";
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "react";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
    allowedHosts: [".trycloudflare.com", ".loca.lt"],
  },
});
