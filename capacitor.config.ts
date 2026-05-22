import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hy39094.sportstoto',
  appName: '전국 스포츠토토 위치 찾기',
  webDir: 'www',
  // 빌드된 정적 파일을 네이티브 WebView에서 띄움
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
