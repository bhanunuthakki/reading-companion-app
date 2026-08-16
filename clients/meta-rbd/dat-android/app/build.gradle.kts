plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.readingcompanion.rbd"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.readingcompanion.rbd"
        minSdk = 29 // DAT-Android requires Android 10+
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2") // ComponentActivity = LifecycleOwner for CameraX
    implementation("com.squareup.okhttp3:okhttp:4.12.0")   // WS transport (skeleton's existing choice)

    // Emulated glasses camera: still capture ONLY — no Preview/ImageAnalysis
    // use case anywhere (battery discipline, hardware-capability-spec.md §2).
    val camerax = "1.3.4"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")

    // Pure-JVM unit tests (protocol encode/decode + backoff). The org.json
    // artifact provides REAL JSONObject/JSONArray on the test classpath —
    // android.jar's org.json classes are throw-only stubs in unit tests.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")

    // Meta Wearables Device Access Toolkit — the DatGlassesDevice seam.
    // DELIBERATELY commented: the main build must never depend on Meta's maven
    // resolving. Uncomment together with device/DatGlassesDevice.kt and the
    // Meta repo in settings.gradle.kts, pinning <version> per
    // https://github.com/facebook/meta-wearables-dat-android
    // implementation("com.meta.wearable:mwdat-core:<version>")
    // implementation("com.meta.wearable:mwdat-camera:<version>")
    // debugImplementation("com.meta.wearable:mwdat-mockdevice:<version>")
}
