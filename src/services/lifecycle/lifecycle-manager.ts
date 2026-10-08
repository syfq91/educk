/**
 * Application Lifecycle & Reliability Manager for educk (Milestone M13).
 *
 * Coordinates mobile OS lifecycle events (backgrounding, resume, freeze, termination,
 * orientation/resize, and network flapping) to ensure reliable state persistence,
 * non-blocking network transitions, and memory management.
 */

export interface LifecycleCallbacks {
  onBackground?: () => Promise<void> | void;
  onForeground?: () => Promise<void> | void;
  onFreeze?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
  onTerminate?: () => Promise<void> | void;
  onOnline?: () => Promise<void> | void;
  onOffline?: () => void;
  onResize?: (width: number, height: number) => Promise<void> | void;
  onMemoryPressure?: () => void;
  onMemoryCleanup?: () => void;
}

export interface LifecycleManagerOptions {
  resizeDebounceMs?: number;
}

export class AppLifecycleManager {
  private callbacks: LifecycleCallbacks;
  private resizeDebounceMs: number;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private memoryCleanupHandlers: Array<() => void> = [];
  private isFrozen = false;
  private destroyed = false;

  // Bound event listener references for proper cleanup
  private boundVisibilityChange: () => void;
  private boundFreeze: () => void;
  private boundResume: () => void;
  private boundPageHide: () => void;
  private boundBeforeUnload: () => void;
  private boundOnline: () => void;
  private boundOffline: () => void;
  private boundResize: () => void;
  private boundOrientationChange: () => void;

  constructor(callbacks: LifecycleCallbacks = {}, options: LifecycleManagerOptions = {}) {
    this.callbacks = callbacks;
    this.resizeDebounceMs = options.resizeDebounceMs ?? 200;

    this.boundVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundFreeze = this.handleFreeze.bind(this);
    this.boundResume = this.handleResume.bind(this);
    this.boundPageHide = this.handleTerminate.bind(this);
    this.boundBeforeUnload = this.handleTerminate.bind(this);
    this.boundOnline = this.handleOnline.bind(this);
    this.boundOffline = this.handleOffline.bind(this);
    this.boundResize = this.handleResize.bind(this);
    this.boundOrientationChange = this.handleResize.bind(this);

    this.attachListeners();
  }

  private attachListeners(): void {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundVisibilityChange);
      // Page Lifecycle API events for mobile WebViews
      document.addEventListener("freeze", this.boundFreeze);
      document.addEventListener("resume", this.boundResume);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.boundPageHide);
      window.addEventListener("beforeunload", this.boundBeforeUnload);
      window.addEventListener("online", this.boundOnline);
      window.addEventListener("offline", this.boundOffline);
      window.addEventListener("resize", this.boundResize);
      window.addEventListener("orientationchange", this.boundOrientationChange);
    }
  }

  private handleVisibilityChange(): void {
    if (this.destroyed) return;
    if (document.visibilityState === "hidden") {
      void this.callbacks.onBackground?.();
    } else if (document.visibilityState === "visible") {
      this.isFrozen = false;
      if (this.callbacks.onForeground) {
        void this.callbacks.onForeground();
      } else {
        void this.callbacks.onResume?.();
      }
    }
  }

  private handleFreeze(): void {
    if (this.destroyed) return;
    this.isFrozen = true;
    this.triggerMemoryCleanup();
    void this.callbacks.onFreeze?.();
  }

  private handleResume(): void {
    if (this.destroyed) return;
    this.isFrozen = false;
    void this.callbacks.onResume?.();
  }

  private handleTerminate(): void {
    if (this.destroyed) return;
    if (this.callbacks.onTerminate) {
      void this.callbacks.onTerminate();
    } else {
      void this.callbacks.onBackground?.();
    }
  }

  private handleOnline(): void {
    if (this.destroyed) return;
    void this.callbacks.onOnline?.();
  }

  private handleOffline(): void {
    if (this.destroyed) return;
    this.callbacks.onOffline?.();
  }

  private handleResize(): void {
    if (this.destroyed) return;
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    this.resizeTimeout = setTimeout(() => {
      const width = typeof window !== "undefined" ? window.innerWidth : 0;
      const height = typeof window !== "undefined" ? window.innerHeight : 0;
      void this.callbacks.onResize?.(width, height);
    }, this.resizeDebounceMs);
  }

  /**
   * Registers a memory cleanup handler called when the app is frozen, backgrounded,
   * or experiencing low memory conditions.
   */
  public registerCleanup(handler: () => void): () => void {
    this.memoryCleanupHandlers.push(handler);
    return () => {
      const index = this.memoryCleanupHandlers.indexOf(handler);
      if (index !== -1) {
        this.memoryCleanupHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Triggers all registered memory cleanup routines (clearing caches, revoking URLs).
   */
  public triggerMemoryCleanup(): void {
    for (const handler of this.memoryCleanupHandlers) {
      try {
        handler();
      } catch (err) {
        console.warn("Error running memory cleanup handler:", err);
      }
    }
    this.callbacks.onMemoryPressure?.();
    this.callbacks.onMemoryCleanup?.();
  }

  /**
   * Checks whether the application currently has network connectivity.
   */
  public isOnline(): boolean {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }

  /**
   * Checks whether the application document is currently hidden or frozen.
   */
  public isBackgrounded(): boolean {
    if (this.isFrozen) return true;
    return typeof document !== "undefined" ? document.visibilityState === "hidden" : false;
  }

  /**
   * Alias for isBackgrounded.
   */
  public isAppBackgrounded(): boolean {
    return this.isBackgrounded();
  }

  /**
   * Tears down all event listeners and cancels pending timers.
   */
  public destroy(): void {
    this.destroyed = true;
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundVisibilityChange);
      document.removeEventListener("freeze", this.boundFreeze);
      document.removeEventListener("resume", this.boundResume);
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.boundPageHide);
      window.removeEventListener("beforeunload", this.boundBeforeUnload);
      window.removeEventListener("online", this.boundOnline);
      window.removeEventListener("offline", this.boundOffline);
      window.removeEventListener("resize", this.boundResize);
      window.removeEventListener("orientationchange", this.boundOrientationChange);
    }

    this.memoryCleanupHandlers = [];
  }
}
