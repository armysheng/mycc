import "@testing-library/jest-dom";
import { afterAll, afterEach } from "vitest";

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
const animationFrameTimers = new Set<number>();

const requestAnimationFrameMock = (callback: FrameRequestCallback): number => {
  const handle = window.setTimeout(() => {
    if (!animationFrameTimers.delete(handle)) return;
    callback(Date.now());
  }, 16);
  animationFrameTimers.add(handle);
  return handle;
};

const cancelAnimationFrameMock = (handle: number) => {
  animationFrameTimers.delete(handle);
  window.clearTimeout(handle);
};

const clearAnimationFrameMocks = () => {
  for (const handle of animationFrameTimers) {
    window.clearTimeout(handle);
  }
  animationFrameTimers.clear();
};

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

afterEach(clearAnimationFrameMocks);
afterAll(clearAnimationFrameMocks);

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
