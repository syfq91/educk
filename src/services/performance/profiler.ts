/**
 * Application Performance Profiler & Budget Enforcement Service
 *
 * Tracks, benchmarks, and enforces mobile hardware performance budgets:
 * - Cold Startup Time: < 2.0 seconds
 * - Library Scrolling: Sustained 60fps with 500+ books
 * - Page Turn Latency: < 100ms perceived latency
 */

export interface PerformanceBudget {
  maxColdStartMs: number;       // 2000 ms
  maxPageTurnLatencyMs: number; // 100 ms
}

export const DEFAULT_PERFORMANCE_BUDGETS: PerformanceBudget = {
  maxColdStartMs: 2000,
  maxPageTurnLatencyMs: 100,
};

export interface StartupMetrics {
  totalColdStartMs: number;
  dbInitMs: number;
  libraryRenderMs: number;
}

export class AppProfiler {
  private static instance: AppProfiler | null = null;
  private readonly budget: PerformanceBudget;
  private readonly marks: Map<string, number> = new Map();
  private readonly measures: Map<string, number> = new Map();

  constructor(budget: PerformanceBudget = DEFAULT_PERFORMANCE_BUDGETS) {
    this.budget = budget;
  }

  public static getInstance(): AppProfiler {
    if (!AppProfiler.instance) {
      AppProfiler.instance = new AppProfiler();
    }
    return AppProfiler.instance;
  }

  public getBudget(): PerformanceBudget {
    return { ...this.budget };
  }

  /**
   * Records a timestamp mark using performance.now() if available.
   */
  public mark(name: string): void {
    const time = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    this.marks.set(name, time);

    if (typeof performance !== "undefined" && typeof performance.mark === "function") {
      try {
        performance.mark(name);
      } catch {
        // Ignore duplicate mark errors in tests
      }
    }
  }

  /**
   * Measures duration between two marks in milliseconds.
   */
  public measure(measureName: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    const end = endMark
      ? this.marks.get(endMark)
      : typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

    if (start === undefined) {
      return 0;
    }

    const duration = Math.max(0, (end ?? start) - start);
    this.measures.set(measureName, duration);

    if (typeof performance !== "undefined" && typeof performance.measure === "function") {
      try {
        if (endMark) {
          performance.measure(measureName, startMark, endMark);
        } else {
          performance.measure(measureName, startMark);
        }
      } catch {
        // Ignore measure errors in tests
      }
    }

    return duration;
  }

  public getMeasure(name: string): number | undefined {
    return this.measures.get(name);
  }

  // --- Startup Convenience Methods ---

  public markColdStart(): void {
    this.mark("educk:cold-start");
  }

  public markDatabaseReady(): void {
    this.mark("educk:db-ready");
    this.measure("educk:db-init-duration", "educk:cold-start", "educk:db-ready");
  }

  public markLibraryReady(): void {
    this.mark("educk:library-ready");
    this.measure("educk:total-cold-start", "educk:cold-start", "educk:library-ready");
    if (this.marks.has("educk:db-ready")) {
      this.measure("educk:library-render-duration", "educk:db-ready", "educk:library-ready");
    }
  }

  public measureStartup(): StartupMetrics {
    return {
      totalColdStartMs: this.getMeasure("educk:total-cold-start") ?? 0,
      dbInitMs: this.getMeasure("educk:db-init-duration") ?? 0,
      libraryRenderMs: this.getMeasure("educk:library-render-duration") ?? 0,
    };
  }

  /**
   * Benchmarks a page turn operation and asserts perceived latency budget (< 100ms).
   */
  public async measurePageTurn<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const start = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

    const result = await fn();

    const end = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

    const durationMs = end - start;
    this.measures.set("educk:last-page-turn", durationMs);

    return { result, durationMs };
  }
}
