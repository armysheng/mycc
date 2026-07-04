import "@testing-library/jest-dom";

// Mock window.matchMedia for tests
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false, // Default to light mode for tests
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock animation frames for GSAP and components that schedule browser paint work.
const requestAnimationFrameMock = (callback: FrameRequestCallback): number =>
  window.setTimeout(() => callback(Date.now()), 16);
const cancelAnimationFrameMock = (handle: number) => window.clearTimeout(handle);

Object.defineProperty(window, "requestAnimationFrame", {
  writable: true,
  value: requestAnimationFrameMock,
});

Object.defineProperty(window, "cancelAnimationFrame", {
  writable: true,
  value: cancelAnimationFrameMock,
});

Object.defineProperty(globalThis, "requestAnimationFrame", {
  writable: true,
  value: requestAnimationFrameMock,
});

Object.defineProperty(globalThis, "cancelAnimationFrame", {
  writable: true,
  value: cancelAnimationFrameMock,
});

// Mock localStorage for tests
const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});
