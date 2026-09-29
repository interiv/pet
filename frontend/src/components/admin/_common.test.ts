import { describe, it, expect } from 'vitest';
import { parseCsvText, normalizeStudentRows, cellText } from './_common';

describe('parseCsvText', () => {
  it('解析普通 CSV', () => {
    const rows = parseCsvText('用户名,姓名\nstu1,张三\nstu2,李四');
    expect(rows).toEqual([
      { 用户名: 'stu1', 姓名: '张三' },
      { 用户名: 'stu2', 姓名: '李四' },
    ]);
  });

  it('去掉 BOM 并兼容 CRLF 换行', () => {
    const rows = parseCsvText('\uFEFF用户名,姓名\r\nstu1,张三\r\n');
    expect(rows).toEqual([{ 用户名: 'stu1', 姓名: '张三' }]);
  });

  it('支持引号包裹且字段内包含逗号', () => {
    const rows = parseCsvText('用户名,备注\nstu1,"张三,班长"\n');
    expect(rows[0].备注).toBe('张三,班长');
  });

  it('支持引号内的转义双引号', () => {
    const rows = parseCsvText('用户名,备注\nstu1,"他说""你好"""\n');
    expect(rows[0].备注).toBe('他说"你好"');
  });

  it('只有表头没有数据行时返回空数组', () => {
    expect(parseCsvText('用户名,姓名')).toEqual([]);
    expect(parseCsvText('')).toEqual([]);
  });
});

describe('normalizeStudentRows', () => {
  it('把中文表头映射为后端字段', () => {
    const out = normalizeStudentRows([{ 用户名: ' stu1 ', 姓名: ' 张三 ', 密码: '111111' }]);
    expect(out).toEqual([{ username: 'stu1', password: '111111', real_name: '张三' }]);
  });

  it('识别英文表头', () => {
    const out = normalizeStudentRows([{ username: 'a', real_name: 'A', email: 'a@b.c' }]);
    expect(out[0]).toMatchObject({ username: 'a', real_name: 'A', email: 'a@b.c' });
  });

  it('过滤掉用户名/密码/姓名全空的行', () => {
    expect(normalizeStudentRows([{ 姓名: '' }, { 用户名: 'ok' }])).toHaveLength(1);
  });

  it('空输入返回空数组', () => {
    expect(normalizeStudentRows([])).toEqual([]);
    expect(normalizeStudentRows(null as any)).toEqual([]);
  });
});

describe('cellText', () => {
  it('null / undefined 转空字符串', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('其它值转字符串', () => {
    expect(cellText(0)).toBe('0');
    expect(cellText(123)).toBe('123');
  });
});
