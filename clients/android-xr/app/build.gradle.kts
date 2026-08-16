plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-surface build (graceful degradation — see README.md):
//
//   DEFAULT            gradle assembleDebug
//     compiles src/main + src/surface-phone. Stable artifacts only.
//     PhonePreviewSurface + ManualWearSource. Runs on the ai_glasses AVD
//     (the AI Glasses Developer Preview image runs standard Android apps)
//     and on any phone AVD.
//
//   GLIMMER            gradle -PenableGlimmer=true assembleDebug
//     swaps in src/surface-glimmer (+ its tests) and adds the ALPHA
//     androidx.xr.glimmer / androidx.xr.projected artifacts. GlimmerSurface +
//     ProjectedLifecycleWearSource (DP4 Device Availability API). The alpha
//     coordinates below are flagged where unverified; if they do not resolve,
//     the default build is untouched — that is the point of the isolation.
// ─────────────────────────────────────────────────────────────────────────────
val enableGlimmer = providers.gradleProperty("enableGlimmer").orNull == "true"

android {
    namespace = "com.readingcompanion.androidxr"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.readingcompanion.androidxr"
        minSdk = 29
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets {
        named("main") {
            java.srcDir(if (enableGlimmer) "src/surface-glimmer/kotlin" else "src/surface-phone/kotlin")
        }
        named("test") {
            if (enableGlimmer) java.srcDir("src/surface-glimmer-test/kotlin")
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // One-still Capture path (emulator/phone camera; the projected-context
    // camera replaces the SOURCE on real glasses — CaptureController TODO(XR)).
    val camerax = "1.3.4"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // real org.json for JVM tests (android.jar ships stubs)
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")

    if (enableGlimmer) {
        // Android XR — Jetpack XR SDK, Developer Preview 4. xr-glimmer and
        // xr-projected are ALPHA (12-io-2026-updates.md). Only
        // projected-testing:1.0.0-alpha07 is documented verbatim in the guide;
        // the other two coordinates are inferred and UNVERIFIED — reconcile
        // against the DP4 release notes before first glimmer build.
        implementation("androidx.xr.glimmer:glimmer:1.0.0-alpha07") // UNVERIFIED coordinate
        implementation("androidx.xr.projected:projected:1.0.0-alpha07") // UNVERIFIED coordinate
        testImplementation("androidx.xr.projected:projected-testing:1.0.0-alpha07") // documented in 12-io-2026-updates.md
    }
}
