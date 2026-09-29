import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTablePagination, useMobile } from './hooks';

describe('useTablePagination', () => {
  it('默认页码与页大小', () => {
    const { result } = renderHook(() => useTablePagination());
    expect(result.current.current).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.pageSizeOptions).toEqual(['10', '20', '50']);
  });

  it('支持自定义默认页大小', () => {
    const { result } = renderHook(() => useTablePagination(20));
    expect(result.current.pageSize).toBe(20);
  });

  it('onChange 会同时更新页码与页大小', () => {
    const { result } = renderHook(() => useTablePagination());
    act(() => result.current.onChange(3, 50));
    expect(result.current.current).toBe(3);
    expect(result.current.pageSize).toBe(50);
  });

  it('showTotal 输出中文总数文案', () => {
    const { result } = renderHook(() => useTablePagination());
    expect(result.current.showTotal(42)).toBe('共 42 条');
  });
});

describe('useMobile', () => {
  const originalWidth = window.innerWidth;

  const setWidth = (w: number) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w });
  };

  beforeEach(() => setWidth(1024));
  afterEach(() => setWidth(originalWidth));

  it('宽度小于 768 判定为移动端', () => {
    setWidth(375);
    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(true);
  });

  it('宽度不小于 768 判定为桌面端', () => {
    setWidth(1280);
    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);
  });

  it('resize 后会重新判定', () => {
    setWidth(1280);
    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);

    setWidth(500);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current).toBe(true);
  });
});
