import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cundai.app',
  appName: 'VideoMeet3DFootball',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  }
};

export default config;
