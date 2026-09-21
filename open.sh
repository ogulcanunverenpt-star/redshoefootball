#!/bin/bash
set -e

echo "======================================================="
echo " ⚽ GameMeet 3D Metaverse & Native Java Server Build "
echo "======================================================="

# Set Android SDK Environment Variables
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin

cd "$(dirname "$0")"

echo "1. Building 3D Football Client with Vite..."
cd redshoefootball/client
npm run build
cd ../..

echo "2. Synchronizing Web Assets to Public & Android Assets..."
cp -r redshoefootball/client/dist/* public/game/
mkdir -p android/app/src/main/assets/public/
cp -r redshoefootball/client/dist/* android/app/src/main/assets/public/

echo "3. Synchronizing Capacitor Android Project..."
npx cap sync android

echo "4. Launching Android App on Emulator / Device..."
npx cap run android
