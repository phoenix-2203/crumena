import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the app talks to the relayer server (pnpm --filter @crumena/server start) on port 8790.
const server = "http://127.0.0.1:8790";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": server, "/rpc": server, "/lcd": server } },
});
