import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/auth": apiTarget,
      "/connect": apiTarget,
    },
  },
});
