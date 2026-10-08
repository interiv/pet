import { describe, it, expect } from 'vitest';
import { judgeLocally, isLocalJudgeable, normalizeOptions, normalizeAnswer } from './quizLocalJudge';

const single = {
  id: 1, question_text: '1+1=?', question_type: 'choice_single',
  options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }],
  answer_text: 'B',
} as any;

const multi = {
  id: 2, question_text: '多选', question_type: 'choice_multi',
  options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }],
  answer_text: 'AC',
} as any;

const judgment = {
  id: 3, question_text: '判断', question_type: 'judgment',
  options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
  answer_text: 'A',
} as any;

describe('normalizeOptions', () => {
  it('解析 JSON 字符串', () => {
    expect(normalizeOptions('[{"key":"A","text":"x"}]')).toEqual([{ key: 'A', text: 'x' }]);
  });
  it('解析对象形式', () => {
    expect(normalizeOptions({ A: 'x', B: 'y' })).toEqual([
      { key: 'A', text: 'x' }, { key: 'B', text: 'y' },
    ]);
  });
  it('非法输入返回空', () => {
    expect(normalizeOptions('not json')).toEqual([]);
    expect(normalizeOptions(null)).toEqual([]);
  });
  it('缺 key 时按顺序补 A/B', () => {
    expect(normalizeOptions([{ text: 'x' }, { text: 'y' }]).map(o => o.key)).toEqual(['A', 'B']);
  });
});

describe('normalizeAnswer', () => {
  it('多选各种分隔符写法等价', () => {
    expect(normalizeAnswer('A,C')).toBe(normalizeAnswer('AC'));
    expect(normalizeAnswer('C、A')).toBe(normalizeAnswer('AC'));
    expect(normalizeAnswer('b,a')).toBe('AB');
  });
  it('判断题词形归一', () => {
    expect(normalizeAnswer('正确')).toBe('T');
    expect(normalizeAnswer('错')).toBe('F');
  });
});

describe('isLocalJudgeable', () => {
  it('客观题有答案有选项 -> 可本地判', () => {
    expect(isLocalJudgeable(single)).toBe(true);
  });
  it('缺标准答案 -> 不可本地判（按要求退回 AI）', () => {
    expect(isLocalJudgeable({ ...single, answer_text: null })).toBe(false);
    expect(isLocalJudgeable({ ...single, answer_text: '  ' })).toBe(false);
  });
  it('简答题 -> 不可本地判', () => {
    expect(isLocalJudgeable({ ...single, question_type: 'essay' })).toBe(false);
  });
  it('历史题目无 question_type -> 不可本地判', () => {
    expect(isLocalJudgeable({ ...single, question_type: null })).toBe(false);
  });
  it('客观题缺选项 -> 不可本地判', () => {
    expect(isLocalJudgeable({ ...single, options: null })).toBe(false);
  });
});

describe('judgeLocally', () => {
  it('单选答对', () => {
    expect(judgeLocally(single, ['B'])).toMatchObject({ isCorrect: true, score: 100, correctAnswer: 'B' });
  });
  it('单选答错', () => {
    expect(judgeLocally(single, ['A'])).toMatchObject({ isCorrect: false, score: 0, correctAnswer: 'B' });
  });
  it('多选选对（乱序）', () => {
    expect(judgeLocally(multi, ['C', 'A'])).toMatchObject({ isCorrect: true, score: 100 });
  });
  it('多选漏选判错', () => {
    expect(judgeLocally(multi, ['A'])).toMatchObject({ isCorrect: false });
  });
  it('判断题标准答案写选项键 A', () => {
    expect(judgeLocally(judgment, ['A'])).toMatchObject({ isCorrect: true, score: 100 });
  });
  it('判断题标准答案直接写「正确」', () => {
    const q = { ...judgment, answer_text: '正确' };
    expect(judgeLocally(q, ['A'])).toMatchObject({ isCorrect: true });
    expect(judgeLocally(q, ['B'])).toMatchObject({ isCorrect: false });
  });
  it('判不了时返回 null 而不是瞎判', () => {
    expect(judgeLocally({ ...single, answer_text: null }, ['A'])).toBeNull();
    expect(judgeLocally({ ...single, question_type: 'essay' }, ['A'])).toBeNull();
  });
  it('没选任何项返回 null', () => {
    expect(judgeLocally(single, [])).toBeNull();
  });
});