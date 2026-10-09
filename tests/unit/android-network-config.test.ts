import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Milestone M18: Android network configuration.
 *
 * These assertions pin the on-device findings from the release APK verification:
 *
 * 1. Plain-HTTP LAN catalogs and covers were rejected with `ERR_CLEARTEXT_NOT_PERMITTED`.
 * 2. The `org.rustls:rustls-platform-verifier` AAR injects its own
 *    `android:networkSecurityConfig` with `cleartextTrafficPermitted="false"`, which takes
 *    precedence over `android:usesCleartextTraffic` once manifest merging runs.
 * 3. The verifier's Kotlin classes are only reachable through JNI, so R8 strips them unless
 *    they are explicitly kept — and every HTTPS request aborts without them.
 */

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(__dirname, "../..", relativePath), "utf-8");

describe("Milestone M18: Android network configuration", () => {
  it("permits cleartext HTTP for self-hosted LAN catalogs", () => {
    const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
    expect(gradle).toContain('manifestPlaceholders["usesCleartextTraffic"] = "true"');
  });

  it("overrides the network security config shipped in the verifier AAR", () => {
    const config = read(
      "src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml",
    );
    expect(config).toContain('cleartextTrafficPermitted="true"');
    // Only the system CA store is trusted: user-installed CAs stay untrusted.
    expect(config).toContain('<certificates src="system" />');
    expect(config).not.toContain('<certificates src="user" />');
  });

  it("pins the Kotlin verifier component to Cargo.lock and shields it from R8", () => {
    const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
    expect(gradle).toContain(
      'implementation("org.rustls:rustls-platform-verifier:$rustlsPlatformVerifierVersion")',
    );
    expect(gradle).toContain('name = \\"rustls-platform-verifier-android\\"');

    const proguard = read("src-tauri/gen/android/app/proguard-rules.pro");
    expect(proguard).toContain(
      "-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }",
    );
  });

  it("keeps the CSP restrictive while allowing catalog covers over HTTP", () => {
    const conf = read("src-tauri/tauri.conf.json");
    const csp = conf.match(/"csp":\s*"([^"]+)"/)?.[1] ?? "";
    expect(csp).not.toBe("");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/img-src[^;]*http:/);
    expect(csp).toMatch(/connect-src[^;]*http:/);

    const html = read("index.html");
    expect(html).toMatch(/img-src[^;]*http:/);
    expect(html).toContain("script-src 'self'");
  });
});
