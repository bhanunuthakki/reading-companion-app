// Root build file. Plugin versions are pinned here and applied in :app.
// AGP 8.5.x + Kotlin 2.0.x per the client build spec; Gradle 8.9 (system
// install — no wrapper jar in this repo), JDK 17.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
}
