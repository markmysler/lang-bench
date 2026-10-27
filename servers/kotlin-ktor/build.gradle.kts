// Kotlin + Ktor server for lang-bench (docs/SPEC.md). The lock files (gradle.lockfile for the
// libraries, buildscript-gradle.lockfile for the Gradle plugins) pin every resolved version.
buildscript {
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
    }
}

plugins {
    kotlin("jvm") version "2.4.21"
    kotlin("plugin.serialization") version "2.4.21"
    id("com.gradleup.shadow") version "9.6.1"
    application
}

repositories {
    mavenCentral()
}

dependencyLocking {
    lockAllConfigurations()
}

dependencies {
    implementation("io.ktor:ktor-server-netty:3.6.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.6.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.6.0")
    implementation("com.zaxxer:HikariCP:7.1.0")
    implementation("org.postgresql:postgresql:42.7.14")
    // Ktor and HikariCP log through SLF4J; this prints warnings and errors to stderr.
    runtimeOnly("org.slf4j:slf4j-simple:2.0.19")
}

application {
    mainClass = "bench.ServerKt"
}

// One executable fat jar, build/libs/app.jar, with the libraries' service files merged.
tasks.shadowJar {
    archiveFileName = "app.jar"
    mergeServiceFiles()
}
