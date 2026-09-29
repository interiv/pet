// 测试环境初始化：注册 jest-dom 断言，并补齐 jsdom 缺失/被抢占的浏览器 API
import '@testing-library/jest-dom/vitest';

// Node 25 内置了一个实验性的 localStorage 全局对象（不带 --localstorage-file 时不可用），
// 会抢在 jsdom 的实现前面，导致 authStore 初始化时 localStorage.getItem is not a function。
// 这里检测并换成内存实现。
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  const impl = {
    getItem: (k: string) => (store.has(String(k)) ? store.get(String(k))! : null),
    setItem: (k: string, v: string) => { store.set(String(k), String(v)); },
    removeItem: (k: string) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: impl, writable: true, configurable: true });
}

// antd 部分组件依赖 matchMedia，jsdom 未实现
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

// antd 的 Table / Tooltip 等依赖 ResizeObserver
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// 说明：这里不需要 afterEach 清理——测试未启用 fake timers，
// 且 vi.mock 的工厂在模块级生效，用例之间不会互相污染。
