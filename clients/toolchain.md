# Toolchain (installed 2026-07-14)

| Component | Path |
|---|---|
| JAVA_HOME | `<path-to-jdk17>` |
| Gradle | `<path-to-gradle>/bin/gradle.bat` |
| ANDROID_HOME | `<path-to-android-sdk>` |
| sdkmanager | `<path-to-android-sdk>/cmdline-tools/latest/bin/sdkmanager.bat` |
| avdmanager | `<path-to-android-sdk>/cmdline-tools/latest/bin/avdmanager.bat` |
| adb | `<path-to-android-sdk>/platform-tools/adb.exe` |
| emulator | `<path-to-android-sdk>/emulator/emulator.exe` |

## AVDs
- companion_phone - android-35 google_apis x86_64, Pixel 8 profile (Meta client target)
- ai_glasses - android-36 **AI Glasses Developer Preview** x86_64 (Android XR client target)

System images present: ai-glasses=True, google-xr(headset)=True

## Env preamble (paste before build commands)

    $env:JAVA_HOME = "<path-to-jdk17>"
    $env:ANDROID_HOME = "<path-to-android-sdk>"
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:Path = "$env:JAVA_HOME\bin;<path-to-gradle>\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;" + $env:Path

Launch an emulator (windowed):  emulator -avd companion_phone   (or ai_glasses)
