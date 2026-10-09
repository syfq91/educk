buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // Kotlin companion component of the `rustls-platform-verifier` crate: it provides the
        // `org.rustls.platformverifier.CertificateVerifier` class that the native certificate
        // verification path calls through JNI. Version is pinned to Cargo.lock in app/build.gradle.kts.
        maven {
            url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

