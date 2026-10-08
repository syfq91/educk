/**
 * OPDS Progression 1.0 HTTP Client
 *
 * Implements Readium OPDS Progression 1.0 REST synchronization protocol.
 * Communicates with OPDS progression endpoints using GET and PUT requests with
 * JSON payload serialization, device tracking, and error handling.
 */

import type { OPDSCatalogAuth } from "../../domain/opds.ts";
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

const DEFAULT_CONFIG: Required<ProgressionClientConfig> = {
  deviceId: "educk-android",
  timeout: 10000,
  maxRetries: 3,
  retryDelay: 500,
  userAgent: "educk/0.1.0 (Android; OPDS Progression 1.0 Client)",
};

function isValidProgressionPayload(data: unknown): data is RemoteProgressionPayload {
  if (!data || typeof data !== "object") return false;
  const p = data as Record<string, unknown>;
  if (typeof p.modified !== "string" || !p.modified) return false;
  if (typeof p.device !== "string") return false;
  if (!p.locator || typeof p.locator !== "object") return false;
  const locator = p.locator as Record<string, unknown>;
  if (!locator.locations || typeof locator.locations !== "object") return false;
  const locations = locator.locations as Record<string, unknown>;
  if (typeof locations.totalProgression !== "number" || isNaN(locations.totalProgression)) return false;
  return true;
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
    const headers = this.buildHeaders(auth, "application/json");

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await fetch(url, {
            method: "GET",
            headers,
            signal: controller.signal,
          });

          if (response.status === 404) {
            // 404 indicates no progression is recorded on the server yet
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

          const data = await response.json();
          if (!isValidProgressionPayload(data)) {
            console.warn(`[ProgressionClient] Invalid progression payload received from ${url}:`, data);
            return null;
          }

          return data;
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
    const headers = this.buildHeaders(auth, "application/json");
    headers["Content-Type"] = "application/json";

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await fetch(url, {
            method: "PUT",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (response.status === 401 || response.status === 403) {
            throw new ProgressionAuthError(`Authentication required (${response.status})`, url);
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
