import { describe, it, expect } from 'vitest';
import {
  questionTypeLabel,
  questionTypeFullName,
  questionTypeColor,
  isSubjectiveType,
  isObjectiveType,
  normalizeQuestionType,
} from './questionTypes';

// 这个模块是「题型 → 中文名」的唯一出口。
// 下面 mostly 锁的是回归：composition（作文）当初在十来个文件里各抄一份表，
// 漏了九处，兜底 `表[type] || type` 就把英文代码直接显示给用户看了。
const ALL_TYPES = [
  'choice_single',
  'choice_multi',
  'judgment',
  'fill_blank',
  'essay',
  'composition',
  'true_false',
  'mixed',
];

describe('questionTypeLabel / questionTypeFullName', () => {
  it('每个已知题型都有中文名，不会漏出英文代码', () => {
    for (const t of ALL_TYPES) {
      expect(questionTypeLabel(t), `questionTypeLabel(${t})`).not.toBe(t);
      expect(questionTypeFullName(t), `questionTypeFullName(${t})`).not.toBe(t);
    }
  });

  it('composition 显示为「作文」而不是 composition', () => {
    expect(questionTypeLabel('composition')).toBe('作文');
    expect(questionTypeFullName('composition')).toBe('作文题');
  });

  it('完整名带「题」字，短名不带', () => {
    expect(questionTypeFullName('choice_single')).toBe('单选题');
    expect(questionTypeLabel('choice_single')).toBe('单选');
  });

  it('true_false 是历史脏数据，按判断题显示', () => {
    expect(questionTypeLabel('true_false')).toBe('判断');
    expect(questionTypeFullName('true_false')).toBe('判断题');
  });

  it('未知题型原样返回，不吞掉也不瞎猜（便于发现脏数据）', () => {
    expect(questionTypeLabel('not_a_type')).toBe('not_a_type');
    expect(questionTypeFullName('not_a_type')).toBe('not_a_type');
  });

  it('空值返回空串，不返回 undefined', () => {
    expect(questionTypeLabel('')).toBe('');
    expect(questionTypeLabel(null)).toBe('');
    expect(questionTypeLabel(undefined)).toBe('');
    expect(questionTypeFullName(null)).toBe('');
  });
});

describe('questionTypeColor', () => {
  it('已知题型返回颜色，未知/空值退回 antd 默认色', () => {
    expect(questionTypeColor('composition')).toBe('magenta');
    expect(questionTypeColor('not_a_type')).toBe('default');
    expect(questionTypeColor(undefined)).toBe('default');
  });
});

describe('isSubjectiveType / isObjectiveType', () => {
  it('essay 与 composition 都算主观题', () => {
    // 口径必须与后端 backend/src/routes/assignments.js 一致：
    // 那里的 subjective 判定是 q.type === 'essay' || q.type === 'composition'。
    // 前端曾只判 essay，导致作文在登记试卷时不给「部分分」。
    expect(isSubjectiveType('essay')).toBe(true);
    expect(isSubjectiveType('composition')).toBe(true);
  });

  it('客观题与主观题互斥且不重叠', () => {
    for (const t of ['choice_single', 'choice_multi', 'judgment', 'fill_blank']) {
      expect(isObjectiveType(t), t).toBe(true);
      expect(isSubjectiveType(t), t).toBe(false);
    }
  });

  it('fill_blank 属客观题（可自动判分），不属于主观题', () => {
    expect(isSubjectiveType('fill_blank')).toBe(false);
  });

  it('空值一律为 false，避免把 undefined 当成某种题型', () => {
    expect(isSubjectiveType(null)).toBe(false);
    expect(isObjectiveType(undefined)).toBe(false);
    expect(isSubjectiveType('not_a_type')).toBe(false);
  });
});

describe('normalizeQuestionType', () => {
  it('去空白并转小写', () => {
    expect(normalizeQuestionType('  Composition ')).toBe('composition');
    expect(normalizeQuestionType('ESSAY')).toBe('essay');
    expect(normalizeQuestionType(null)).toBe('');
  });
});
