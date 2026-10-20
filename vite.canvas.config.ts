import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./canvas", import.meta.url)),
  base: "./",
  build: {
    outDir: "../dist/canvas",
    emptyOutDir: true,
  },
});
