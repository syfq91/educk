/**
 * OPDS Progression 1.0 HTTP Client
 *
 * Implements Readium OPDS Progression 1.0 REST synchronization protocol.
 * Communicates with OPDS progression endpoints using GET and PUT requests with
 * JSON payload serialization, device tracking, and error handling.
 *
 * Provides bidirectional compatibility with:
 * - Readium OPDS Progression 1.0 specification (locator-based)
 * - BookFlow specification (top-level progression, device object, application/opds-progression+json)
 */

import type { OPDSCatalogAuth } from "../../domain/opds.ts";
import { httpRequest } from "../http/index.ts";
import type {
  IProgressionClient,
  ProgressionClientConfig,
  RemoteProgressionPayload,
} from "../../domain/progression.ts";

export class ProgressionNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "ProgressionNetworkError";
  }
}

export class ProgressionAuthError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "ProgressionAuthError";
  }
}

export class ProgressionConflictError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "ProgressionConflictError";
  }
}

const DEFAULT_CONFIG: Required<ProgressionClientConfig> = {
  deviceId: "educk-android",
  timeout: 10000,
  maxRetries: 3,
  retryDelay: 500,
  userAgent: "educk/0.1.0 (Android; OPDS Progression 1.0 Client)",
};

export function isValidProgressionPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const p = data as Record<string, unknown>;
  if (typeof p.modified !== "string" || !p.modified) return false;

  const hasValidDevice =
    (typeof p.device === "string" && p.device.length > 0) ||
    (typeof p.device === "object" &&
      p.device !== null &&
      typeof (p.device as { id?: unknown }).id === "string" &&
      (p.device as { id: string }).id.length > 0);
  if (!hasValidDevice) return false;

  const hasTopLevelProgression = typeof p.progression === "number" && !isNaN(p.progression);
  const locator = p.locator as Record<string, unknown> | undefined;
  const locations = locator?.locations as Record<string, unknown> | undefined;
  const hasLocatorProgression =
    typeof locations?.totalProgression === "number" && !isNaN(locations.totalProgression as number);

  return hasTopLevelProgression || hasLocatorProgression;
}

export function normalizeProgressionPayload(data: unknown): RemoteProgressionPayload {
  const p = data as Record<string, unknown>;
  const modified = typeof p.modified === "string" ? p.modified : new Date().toISOString();

  let device = "unknown-device";
  if (typeof p.device === "string") {
    device = p.device;
  } else if (typeof p.device === "object" && p.device !== null) {
    const devObj = p.device as { id?: string; name?: string };
    device = devObj.id || "unknown-device";
  }

  const topProg = typeof p.progression === "number" && !isNaN(p.progression) ? p.progression : undefined;
  const locator = p.locator as Record<string, unknown> | undefined;
  const locations = locator?.locations as Record<string, unknown> | undefined;
  const locProg =
    typeof locations?.totalProgression === "number" && !isNaN(locations.totalProgression as number)
      ? (locations.totalProgression as number)
      : undefined;

  const totalProg = topProg ?? locProg ?? 0.0;
  const title =
    (typeof p.title === "string" ? p.title : undefined) ||
    (typeof locator?.title === "string" ? (locator.title as string) : undefined);
  const references = Array.isArray(p.references) ? (p.references as string[]) : undefined;
  const href =
    (typeof locator?.href === "string" ? (locator.href as string) : undefined) ||
    (references && references.length > 0 ? references[0] : undefined);
  const cfi = typeof locations?.cfi === "string" ? (locations.cfi as string) : undefined;

  return {
    modified,
    device,
    progression: totalProg,
    title,
    references,
    locator: {
      href,
      title,
      type: typeof locator?.type === "string" ? (locator.type as string) : undefined,
      locations: {
        cfi,
        progression: totalProg,
        totalProgression: totalProg,
      },
    },
  };
}

export class ProgressionClient implements IProgressionClient {
  private config: Required<ProgressionClientConfig>;

  constructor(config: Partial<ProgressionClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setDeviceId(deviceId: string): void {
    this.config.deviceId = deviceId;
  }

  async getProgression(url: string, auth?: OPDSCatalogAuth): Promise<RemoteProgressionPayload | null> {
    const headers = this.buildHeaders(
      auth,
      "application/opds-progression+json, application/json;q=0.9, */*;q=0.8",
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await httpRequest(url, {
            method: "GET",
            headers,
            timeoutMs: this.config.timeout,
            signal: controller.signal,
          });

          if (response.status === 404 || response.status === 204) {
            // 404 or 204 indicates no progression is recorded on the server yet
            return null;
          }

          if (response.status === 401 || response.status === 403) {
            throw new ProgressionAuthError(`Authentication required (${response.status})`, url);
          }

          if (response.status >= 500) {
            throw new ProgressionNetworkError(`Server error HTTP ${response.status}`, undefined, url);
          }

          if (!response.ok) {
            throw new ProgressionNetworkError(`HTTP ${response.status}: ${response.statusText}`, undefined, url);
          }

          const text = await response.text();
          if (!text || !text.trim()) {
            // Empty body (BookFlow returns 200 with empty body when book has no progression yet)
            return null;
          }

          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            console.warn(`[ProgressionClient] Failed to parse JSON response from ${url}:`, text);
            return null;
          }

          if (!isValidProgressionPayload(data)) {
            console.warn(`[ProgressionClient] Invalid progression payload received from ${url}:`, data);
            return null;
          }

          return normalizeProgressionPayload(data);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof ProgressionAuthError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          await this.sleep(this.config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw new ProgressionNetworkError(
      `Failed to get progression after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
      lastError || undefined,
      url,
    );
  }

  async putProgression(
    url: string,
    payload: RemoteProgressionPayload,
    auth?: OPDSCatalogAuth,
  ): Promise<boolean> {
    const headers = this.buildHeaders(
      auth,
      "application/opds-progression+json, application/json;q=0.9, */*;q=0.8",
    );
    headers["Content-Type"] = "application/opds-progression+json";

    const progressionVal =
      typeof payload.progression === "number"
        ? payload.progression
        : payload.locator?.locations?.totalProgression ?? 0.0;

    const deviceVal =
      typeof payload.device === "object" && payload.device !== null
        ? payload.device
        : { id: payload.device || this.config.deviceId, name: "educk Reader" };

    const outgoingPayload: Record<string, unknown> = {
      modified: payload.modified,
      progression: progressionVal,
      device: deviceVal,
      ...(payload.title ? { title: payload.title } : (payload.locator?.title ? { title: payload.locator.title } : {})),
      ...(payload.references ? { references: payload.references } : (payload.locator?.href ? { references: [payload.locator.href] } : {})),
      ...(payload.locator ? { locator: payload.locator } : {}),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await httpRequest(url, {
            method: "PUT",
            headers,
            body: JSON.stringify(outgoingPayload),
            timeoutMs: this.config.timeout,
            signal: controller.signal,
          });

          if (response.status === 401 || response.status === 403) {
            throw new ProgressionAuthError(`Authentication required (${response.status})`, url);
          }

          if (response.status === 409) {
            throw new ProgressionConflictError(
              `A newer progression is already stored on the server (HTTP 409)`,
              url,
            );
          }

          if (response.status >= 500) {
            throw new ProgressionNetworkError(`Server error HTTP ${response.status}`, undefined, url);
          }

          if (!response.ok && response.status !== 204) {
            throw new ProgressionNetworkError(`HTTP ${response.status}: ${response.statusText}`, undefined, url);
          }

          return true;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof ProgressionAuthError || error instanceof ProgressionConflictError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          await this.sleep(this.config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw new ProgressionNetworkError(
      `Failed to put progression after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
      lastError || undefined,
      url,
    );
  }

  private buildHeaders(auth?: OPDSCatalogAuth, accept = "application/json"): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": this.config.userAgent,
    };

    if (this.config.deviceId) {
      headers["X-Device-Id"] = this.config.deviceId;
    }

    if (auth) {
      switch (auth.type) {
        case "basic":
          if (auth.username && auth.password) {
            const credentials = btoa(`${auth.username}:${auth.password}`);
            headers["Authorization"] = `Basic ${credentials}`;
          }
          break;
        case "bearer":
          if (auth.token) {
            headers["Authorization"] = `Bearer ${auth.token}`;
          }
          break;
      }
    }

    return headers;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createProgressionClient(config?: Partial<ProgressionClientConfig>): ProgressionClient {
  return new ProgressionClient(config);
}
