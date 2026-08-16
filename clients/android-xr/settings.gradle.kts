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
        google() // Jetpack XR (androidx.xr.*) artifacts live here
        mavenCentral()
    }
}
rootProject.name = "reading-companion-android-xr"
include(":app")
