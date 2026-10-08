import { vi, beforeEach } from "vitest";
import { Window } from "happy-dom";

// Preserve Node's native fetch before happy-dom setup so E2E tests can use real HTTP
const originalNativeFetch = globalThis.fetch;
(global as unknown as { __NATIVE_FETCH__?: typeof fetch }).__NATIVE_FETCH__ = originalNativeFetch;

// Create a global window object with happy-dom
const window = new Window({
  url: "http://localhost",
  width: 800,
  height: 600,
});

// Set up global DOM APIs
global.window = window;
global.document = window.document;

// Use Object.defineProperty for read-only globals
Object.defineProperty(global, "navigator", { value: window.navigator, writable: true, configurable: true });

// HTML Elements
global.HTMLElement = window.HTMLElement;
global.HTMLButtonElement = window.HTMLButtonElement;
global.HTMLInputElement = window.HTMLInputElement;
global.HTMLSelectElement = window.HTMLSelectElement;
global.HTMLDivElement = window.HTMLDivElement;
global.HTMLSpanElement = window.HTMLSpanElement;
global.HTMLFormElement = window.HTMLFormElement;
global.HTMLAnchorElement = window.HTMLAnchorElement;
global.HTMLImageElement = window.HTMLImageElement;
global.HTMLUListElement = window.HTMLUListElement;
global.HTMLLIElement = window.HTMLLIElement;
global.HTMLHeadingElement = window.HTMLHeadingElement;
global.HTMLParagraphElement = window.HTMLParagraphElement;
global.HTMLLabelElement = window.HTMLLabelElement;
global.HTMLFieldSetElement = window.HTMLFieldSetElement;
global.HTMLLegendElement = window.HTMLLegendElement;
global.HTMLTextAreaElement = window.HTMLTextAreaElement;

// Core DOM APIs
global.Node = window.Node;
global.Element = window.Element;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.KeyboardEvent = window.KeyboardEvent;
global.MouseEvent = window.MouseEvent;
global.TouchEvent = window.TouchEvent;
global.Touch = window.Touch;
global.DOMParser = window.DOMParser;
global.URL = window.URL;
global.Headers = window.Headers;
global.Request = window.Request;
global.Response = window.Response;
global.fetch = window.fetch;
global.btoa = window.btoa;
global.atob = window.atob;
global.setTimeout = window.setTimeout;
global.clearTimeout = window.clearTimeout;
global.setInterval = window.setInterval;
global.clearInterval = window.clearInterval;

// Add NodeFilter (used by foliate-js)
global.NodeFilter = window.NodeFilter;

// Add customElements (used by foliate-js for web components)
global.customElements = window.customElements;

// Mock Tauri invoke globally
const mockInvoke = vi.fn();
global.invoke = mockInvoke;

// Mock window.__TAURI_INTERNALS__
global.__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Mock alert
global.alert = vi.fn();

// Mock confirm
global.confirm = vi.fn(() => true);

// Mock fetch for OPDS tests
const mockFetch = vi.fn();
(global as unknown as { __MOCK_FETCH__?: typeof mockFetch }).__MOCK_FETCH__ = mockFetch;
global.fetch = mockFetch;

// Reset mocks before each test
beforeEach(() => {
  mockInvoke.mockReset();
  mockFetch.mockReset();
  vi.clearAllMocks();
  
  // Reset DOM
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});