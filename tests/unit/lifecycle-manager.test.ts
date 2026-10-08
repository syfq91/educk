import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppLifecycleManager, type LifecycleCallbacks } from "../../src/services/lifecycle/lifecycle-manager.ts";

describe("Milestone M13: AppLifecycleManager", () => {
  let callbacks: LifecycleCallbacks;
  let manager: AppLifecycleManager | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    callbacks = {
      onBackground: vi.fn().mockResolvedValue(undefined),
      onFreeze: vi.fn().mockResolvedValue(undefined),
      onResume: vi.fn().mockResolvedValue(undefined),
      onResize: vi.fn().mockResolvedValue(undefined),
      onOnline: vi.fn().mockResolvedValue(undefined),
      onOffline: vi.fn(),
      onMemoryCleanup: vi.fn(),
    };
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
      manager = null;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("handles visibilitychange when transitioning to hidden (background)", () => {
    manager = new AppLifecycleManager(callbacks);

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(callbacks.onBackground).toHaveBeenCalledTimes(1);
    expect(callbacks.onResume).not.toHaveBeenCalled();
    expect(manager.isAppBackgrounded()).toBe(true);
  });

  it("handles visibilitychange when transitioning to visible (foreground)", () => {
    manager = new AppLifecycleManager(callbacks);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(callbacks.onResume).toHaveBeenCalledTimes(1);
    expect(callbacks.onBackground).not.toHaveBeenCalled();
    expect(manager.isAppBackgrounded()).toBe(false);
  });

  it("handles Page Lifecycle API freeze event", () => {
    manager = new AppLifecycleManager(callbacks);

    document.dispatchEvent(new Event("freeze"));

    expect(callbacks.onFreeze).toHaveBeenCalledTimes(1);
    expect(manager.isAppBackgrounded()).toBe(true);
  });

  it("handles Page Lifecycle API resume event", () => {
    manager = new AppLifecycleManager(callbacks);

    document.dispatchEvent(new Event("resume"));

    expect(callbacks.onResume).toHaveBeenCalledTimes(1);
    expect(manager.isAppBackgrounded()).toBe(false);
  });

  it("handles pagehide event as background trigger", () => {
    manager = new AppLifecycleManager(callbacks);

    window.dispatchEvent(new Event("pagehide"));

    expect(callbacks.onBackground).toHaveBeenCalledTimes(1);
  });

  it("handles beforeunload event as background trigger", () => {
    manager = new AppLifecycleManager(callbacks);

    window.dispatchEvent(new Event("beforeunload"));

    expect(callbacks.onBackground).toHaveBeenCalledTimes(1);
  });

  it("handles online and offline network state transitions", () => {
    manager = new AppLifecycleManager(callbacks);

    window.dispatchEvent(new Event("online"));
    expect(callbacks.onOnline).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("offline"));
    expect(callbacks.onOffline).toHaveBeenCalledTimes(1);
  });

  it("debounces rapid resize/orientation change events", () => {
    manager = new AppLifecycleManager(callbacks, { resizeDebounceMs: 200 });

    // Fire 5 rapid resize events
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));

    // Callback should not be called immediately
    expect(callbacks.onResize).not.toHaveBeenCalled();

    // Fast-forward 150ms (before debounce completes)
    vi.advanceTimersByTime(150);
    expect(callbacks.onResize).not.toHaveBeenCalled();

    // Fast-forward another 100ms (total 250ms, debounce expires)
    vi.advanceTimersByTime(100);
    expect(callbacks.onResize).toHaveBeenCalledTimes(1);
  });

  it("cleans up all event listeners and timers on destroy()", () => {
    manager = new AppLifecycleManager(callbacks, { resizeDebounceMs: 200 });

    window.dispatchEvent(new Event("resize"));
    manager.destroy();

    // Advance time after destroy - debounced callback must not fire
    vi.advanceTimersByTime(300);
    expect(callbacks.onResize).not.toHaveBeenCalled();

    // Further events should not trigger callbacks
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("pagehide"));

    expect(callbacks.onOnline).not.toHaveBeenCalled();
    expect(callbacks.onOffline).not.toHaveBeenCalled();
    expect(callbacks.onBackground).not.toHaveBeenCalled();
  });

  it("triggers memory cleanup callback when requested", () => {
    manager = new AppLifecycleManager(callbacks);

    manager.triggerMemoryCleanup();
    expect(callbacks.onMemoryCleanup).toHaveBeenCalledTimes(1);
  });
});
