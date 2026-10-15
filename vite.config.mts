import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/webview",
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/webview"),
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/webview/index.html"),
      output: {
        entryFileNames: "index.js",
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? info.name ?? "";
          return name.endsWith(".css") ? "index.css" : "[name][extname]";
        },
        chunkFileNames: "chunk-[name].js",
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
  },
});
