import { vi, beforeEach } from "vitest";

// Mock Tauri invoke globally
const mockInvoke = vi.fn();
vi.stubGlobal("invoke", mockInvoke);

// Mock window.__TAURI_INTERNALS__
vi.stubGlobal("__TAURI_INTERNALS__", {
  invoke: mockInvoke,
});

// Mock alert
vi.stubGlobal("alert", vi.fn());

// Mock confirm
vi.stubGlobal("confirm", vi.fn(() => true));

// Mock fetch for OPDS tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Reset mocks before each test
beforeEach(() => {
  mockInvoke.mockReset();
  mockFetch.mockReset();
  vi.clearAllMocks();
});