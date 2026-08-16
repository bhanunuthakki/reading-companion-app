# Toolchain (installed 2026-07-14)

| Component | Path |
|---|---|
| JAVA_HOME | C:\Users\Bhanu\android-toolchain\jdk17 |
| Gradle | C:\Users\Bhanu\android-toolchain\gradle-8.9\bin\gradle.bat |
| ANDROID_HOME | C:\Users\Bhanu\AppData\Local\Android\Sdk |
| sdkmanager | C:\Users\Bhanu\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat |
| avdmanager | C:\Users\Bhanu\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\avdmanager.bat |
| adb | C:\Users\Bhanu\AppData\Local\Android\Sdk\platform-tools\adb.exe |
| emulator | C:\Users\Bhanu\AppData\Local\Android\Sdk\emulator\emulator.exe |

## AVDs
- companion_phone - android-35 google_apis x86_64, Pixel 8 profile (Meta client target)
- ai_glasses - android-36 **AI Glasses Developer Preview** x86_64 (Android XR client target)

System images present: ai-glasses=True, google-xr(headset)=True

## Env preamble (paste before build commands)

    $env:JAVA_HOME = "C:\Users\Bhanu\android-toolchain\jdk17"
    $env:ANDROID_HOME = "C:\Users\Bhanu\AppData\Local\Android\Sdk"
    $env:ANDROID_SDK_ROOT = "C:\Users\Bhanu\AppData\Local\Android\Sdk"
    $env:Path = "C:\Users\Bhanu\android-toolchain\jdk17\bin;C:\Users\Bhanu\android-toolchain\gradle-8.9\bin;C:\Users\Bhanu\AppData\Local\Android\Sdk\platform-tools;C:\Users\Bhanu\AppData\Local\Android\Sdk\emulator;" + $env:Path

Launch an emulator (windowed):  emulator -avd companion_phone   (or ai_glasses)
