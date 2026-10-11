import { describe, it, expect } from 'vitest';
import {
  questionTypeLabel,
  questionTypeFullName,
  questionTypeColor,
  isSubjectiveType,
  isObjectiveType,
  needsSelfMarkRetry,
  isFillBlankType,
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
    // 口径必须与后端 backend/src/routes/assignments.js 的 isObjectiveType 镜像一致。
    expect(isSubjectiveType('essay')).toBe(true);
    expect(isSubjectiveType('composition')).toBe(true);
  });

  it('填空题算主观题：改由 AI 判分，不再按逗号逐空精确比对', () => {
    // 这条断言锁的是一次真实决策：填空题答案「北京 上海」与「北京，上海」意思相同，
    // 规则比对会判 0 分，所以移出客观题集合，交给 AI。
    expect(isSubjectiveType('fill_blank')).toBe(true);
    expect(isObjectiveType('fill_blank')).toBe(false);
  });

  it('客观题与主观题互斥且不重叠', () => {
    const all = ['choice_single', 'choice_multi', 'judgment', 'essay', 'composition', 'fill_blank'];
    for (const t of all) {
      expect(isObjectiveType(t) !== isSubjectiveType(t), t).toBe(true);
    }
  });

  it('空值一律为 false，避免把 undefined 当成某种题型', () => {
    expect(isSubjectiveType(null)).toBe(false);
    expect(isObjectiveType(undefined)).toBe(false);
    expect(isSubjectiveType('not_a_type')).toBe(false);
  });
});

describe('needsSelfMarkRetry', () => {
  it('只有作文类需要在错题本重做时自评对错', () => {
    expect(needsSelfMarkRetry('essay')).toBe(true);
    expect(needsSelfMarkRetry('composition')).toBe(true);
  });

  it('填空题不要求自评：错题本重做走规则比对，直接交卷即可', () => {
    expect(needsSelfMarkRetry('fill_blank')).toBe(false);
    expect(needsSelfMarkRetry('choice_single')).toBe(false);
    expect(needsSelfMarkRetry(undefined)).toBe(false);
  });
});

describe('isFillBlankType', () => {
  it('归一化后识别，历史脏数据也能认出', () => {
    expect(isFillBlankType('fill_blank')).toBe(true);
    expect(isFillBlankType(' Fill_Blank ')).toBe(true);
    expect(isFillBlankType('essay')).toBe(false);
    expect(isFillBlankType(null)).toBe(false);
  });
});

describe('normalizeQuestionType', () => {
  it('去空白并转小写', () => {
    expect(normalizeQuestionType('  Composition ')).toBe('composition');
    expect(normalizeQuestionType('ESSAY')).toBe('essay');
    expect(normalizeQuestionType(null)).toBe('');
  });
});
