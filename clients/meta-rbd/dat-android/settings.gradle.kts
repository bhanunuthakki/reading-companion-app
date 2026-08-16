pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Meta Wearables DAT artifacts (mwdat-core / mwdat-camera / mwdat-mockdevice)
        // are published per the DAT-Android setup guide; add Meta's Maven repo here.
        // See https://github.com/facebook/meta-wearables-dat-android
    }
}
rootProject.name = "reading-companion-rbd"
include(":app")
