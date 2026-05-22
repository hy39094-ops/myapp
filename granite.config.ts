import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "sports-toto", // 콘솔에 입력한 appName을 입력하세요.
  brand: {
    displayName: "전국 스포츠토토 판매점", // 콘솔에 입력한 앱 이름과 동일해야 검수 통과
    primaryColor: "#FF91D5",
    icon: "https://static.toss.im/appsintoss/44501/2c901fc3-2bb6-482e-98dd-c70d480328f2.png",
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [],
  outdir: "dist",
});