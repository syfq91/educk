import { vi, beforeEach } from "vitest";

// Mock alert
vi.stubGlobal("alert", vi.fn());

// Mock confirm
vi.stubGlobal("confirm", vi.fn(() => true));

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});