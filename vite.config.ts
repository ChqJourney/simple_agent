import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async () => {
  // @ts-expect-error process is a nodejs global
  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [react(), tailwindcss()],

    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom", "zustand"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom", "zustand"],
            markdown: ["react-markdown"],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
