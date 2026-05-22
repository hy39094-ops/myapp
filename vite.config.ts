import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Capacitor WebView에서도 동작하도록 상대경로 빌드
  base: "./",
});
