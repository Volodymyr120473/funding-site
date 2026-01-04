import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/funding": {
        target: "http://localhost:4666",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:4666",
        changeOrigin: true,
      },
    },
  },
});
