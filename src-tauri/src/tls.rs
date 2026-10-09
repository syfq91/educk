//! Platform TLS trust configuration.
//!
//! `reqwest` (with the `rustls` feature) validates certificates through
//! `rustls-platform-verifier`. On Android that verifier delegates to the platform
//! `TrustManager`, which requires a live JVM handle and the companion Kotlin component
//! shipped as `org.rustls:rustls-platform-verifier` (see `app/build.gradle.kts`).
//!
//! Until [`init_platform_certificate_verifier`] has run, the very first HTTPS handshake
//! panics with `Expect rustls-platform-verifier to be initialized`. Because this crate is
//! built with `panic = "abort"`, that panic kills the whole process, so the initialization
//! must happen during application setup, before any network I/O is started.

/// Installs the Android platform certificate verifier.
///
/// Returns `Err` when the JVM handles are unavailable; callers should log the failure
/// because every subsequent HTTPS request would otherwise abort the process.
#[cfg(target_os = "android")]
pub fn init_platform_certificate_verifier() -> Result<(), String> {
    use jni::objects::JObject;
    use jni::vm::JavaVM;

    let android_context = ndk_context::android_context();

    if android_context.vm().is_null() || android_context.context().is_null() {
        return Err("Android application context is not available".to_string());
    }

    // SAFETY: `tao` initializes the ndk-context with a valid `JavaVM` pointer and a JNI
    // global reference to the application `Context` during `ANativeActivity::onCreate`,
    // which always runs before Tauri's `setup` hook.
    let vm = unsafe { JavaVM::from_raw(android_context.vm() as *mut jni::sys::JavaVM) };

    let context_ptr = android_context.context() as jni::sys::jobject;

    let attached = vm.attach_current_thread(|env| {
        // SAFETY: the pointer is the global reference owned by ndk-context and is valid for
        // the lifetime of this process.
        let context = unsafe { JObject::from_raw(env, context_ptr) };
        rustls_platform_verifier::android::init_with_env(env, context)
    });

    map_err(attached, "Failed to initialize the platform certificate verifier")?;
    Ok(())
}

/// No-op on desktop platforms, where `rustls-platform-verifier` reads the system trust
/// store directly and needs no JNI bootstrap.
#[cfg(not(target_os = "android"))]
pub fn init_platform_certificate_verifier() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
fn map_err<T>(result: Result<T, impl std::fmt::Display>, context: &str) -> Result<T, String> {
    result.map_err(|err| format!("{context}: {err}"))
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::init_platform_certificate_verifier;

    #[test]
    fn desktop_initialization_is_a_no_op() {
        assert!(init_platform_certificate_verifier().is_ok());
    }
}
