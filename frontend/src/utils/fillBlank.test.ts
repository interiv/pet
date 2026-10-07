import { describe, it, expect } from 'vitest';
import {
  splitContentByBlanks,
  countBlanks,
  splitFillBlankAnswer,
  normalizeBlankValue,
  isFillBlankAnswered,
  toBlankValueArray,
  joinFillBlankAnswers,
} from './fillBlank';

// 这个模块锁的是一个具体的体验问题：
// 「中国______的首都是______，它位于______平原。」这样的三空题，
// 界面上原来只有一个输入框 + 一句「多个空用英文逗号分隔」，
// 学生要自己数第几个逗号对应第几个空，填错顺序、漏填一个都很难自查。

describe('splitContentByBlanks', () => {
  it('识别 AI 出题约定的 6 个半角下划线', () => {
    const r = splitContentByBlanks('中国的首都是______。');
    expect(r.blankCount).toBe(1);
    expect(r.parts).toEqual(['中国的首都是', '。']);
  });

  it('识别 2/3/4 个下划线与全角下划线', () => {
    expect(countBlanks('a____b')).toBe(1);
    expect(countBlanks('a___b')).toBe(1);
    expect(countBlanks('a__b')).toBe(1);
    expect(countBlanks('a＿b')).toBe(1);
    expect(countBlanks('a＿＿＿＿b')).toBe(1);
  });

  it('一题多空按出现顺序切开，片段时间和顺序都不许乱', () => {
    const r = splitContentByBlanks('中国的首都是______，它是______，位于______平原。');
    expect(r.blankCount).toBe(3);
    expect(r.parts).toEqual(['中国的首都是', '，它是', '，位于', '平原。']);
    // parts[0] 是第 1 空之前的文字，parts[i] 是第 i 空与第 i+1 空之间的文字
    expect(r.parts.length).toBe(4);
  });

  it('题干以空位开头/以空位结尾都要数得出来', () => {
    // 这两种边界曾把第 1 个空算丢：界面渲染不出输入框，
    // 学生看到的是「只有题干、没有框」，提交却报「没作答」
    expect(countBlanks('______是中国的首都')).toBe(1);
    expect(countBlanks('中国的首都是______')).toBe(1);
    expect(countBlanks('______')).toBe(1);
    expect(countBlanks('a______b______c')).toBe(2);
  });

  it('空位只在题干末尾时，前后空白不吞字', () => {
    const r = splitContentByBlanks('中国的首都是______');
    expect(r.parts).toEqual(['中国的首都是', '']);
  });

  it('识别全角括号留空（纸质试卷常见写法），但不动括号里有字的普通标点', () => {
    expect(countBlanks('光合作用的场所是（　）')).toBe(1);
    expect(countBlanks('见下页（　　）')).toBe(1);
    // 括号内只有空白（哪怕只一个空格）也算空位：纸质卷面上就是这样印的
    expect(countBlanks('叫做（  ）')).toBe(1);
    // 括号里有字就是普通标点，误判成空位会凭空多出一个输入框，比漏识别更难解释
    expect(countBlanks('参考（必修一）')).toBe(0);
    expect(countBlanks('称为（叶绿体）')).toBe(0);
  });

  it('没有空位时退化为「单块文本 + 0 空」，供 UI 回落到单个输入框', () => {
    const r = splitContentByBlanks('光合作用的场所是？');
    expect(r.blankCount).toBe(0);
    expect(r.parts).toEqual(['光合作用的场所是？']);
    expect(countBlanks('')).toBe(0);
    expect(countBlanks(null)).toBe(0);
    expect(countBlanks(undefined)).toBe(0);
  });
});

describe('splitFillBlankAnswer', () => {
  it('英文逗号、中文逗号、顿号、分号都能拆', () => {
    expect(splitFillBlankAnswer('北京,上海')).toEqual(['北京', '上海']);
    expect(splitFillBlankAnswer('北京，上海')).toEqual(['北京', '上海']);
    expect(splitFillBlankAnswer('北京、上海')).toEqual(['北京', '上海']);
    expect(splitFillBlankAnswer('北京; 上海')).toEqual(['北京', '上海']);
  });

  it('不按空白拆：答案本身就可能含空格或英文词组', () => {
    // 按空白拆会把 "New York" 劈成两个空，
    // 明明一个空的题会被判成漏填一空
    expect(splitFillBlankAnswer('New York')).toEqual(['New York']);
    expect(splitFillBlankAnswer('Newton, London')).toEqual(['Newton', 'London']);
  });

  it('丢掉多余空段：学生写成「北京，」不算两空', () => {
    expect(splitFillBlankAnswer('北京,')).toEqual(['北京']);
    expect(splitFillBlankAnswer('北京,,上海')).toEqual(['北京', '上海']);
  });

  it('数组形态直接展平，undefined/null 不炸', () => {
    expect(splitFillBlankAnswer(['北京', '上海'])).toEqual(['北京', '上海']);
    expect(splitFillBlankAnswer(null)).toEqual([]);
    expect(splitFillBlankAnswer(undefined)).toEqual([]);
  });
});

describe('normalizeBlankValue', () => {
  it('去内部空白 + 转小写，大小写与空格差异不算错', () => {
    expect(normalizeBlankValue(' New York ')).toBe('newyork');
    expect(normalizeBlankValue('NEWYORK')).toBe('newyork');
    expect(normalizeBlankValue('牛顿')).toBe('牛顿');
    // 全角空格也清掉，否则「牛顿　第一定律」和「牛顿第一定律」会判成两个答案
    expect(normalizeBlankValue('牛顿　第一定律')).toBe('牛顿第一定律');
  });
});

describe('isFillBlankAnswered', () => {
  it('每空都填了才算做完', () => {
    expect(isFillBlankAnswered(['北京', '上海'], 2)).toBe(true);
    expect(isFillBlankAnswered(['北京', ''], 2)).toBe(false);
    expect(isFillBlankAnswered(['北京'], 2)).toBe(false);
    expect(isFillBlankAnswered([], 2)).toBe(false);
  });

  it('填了纯空格的空不算数', () => {
    expect(isFillBlankAnswered(['北京', '　 '], 2)).toBe(false);
    expect(isFillBlankAnswered(['北京', '\n\t'], 2)).toBe(false);
  });

  it('识别不出空数时，只要有一段非空答案就算作答', () => {
    expect(isFillBlankAnswered('叶绿体', 0)).toBe(true);
    expect(isFillBlankAnswered('', 0)).toBe(false);
    expect(isFillBlankAnswered('  ', 0)).toBe(false);
    expect(isFillBlankAnswered([], 0)).toBe(false);
  });

  it('逗号整串形态（历史数据）按空拆开判', () => {
    expect(isFillBlankAnswered('甲,乙', 2)).toBe(true);
    expect(isFillBlankAnswered('甲', 2)).toBe(false);
  });
});

describe('toBlankValueArray', () => {
  it('总是返回与空数等长的数组', () => {
    expect(toBlankValueArray(undefined, 3)).toEqual(['', '', '']);
    expect(toBlankValueArray(['甲'], 3)).toEqual(['甲', '', '']);
    expect(toBlankValueArray(['甲', '乙', '丙', '丁'], 3)).toEqual(['甲', '乙', '丙']);
  });

  it('逗号整串会被拆开并按空对齐（第 2 空不会错位到第 3 空）', () => {
    expect(toBlankValueArray('甲,乙,丙', 3)).toEqual(['甲', '乙', '丙']);
    // 只给了 2 段而题目有 3 空：第 3 空补空，绝不把「乙」当成第 3 空的答案
    expect(toBlankValueArray('甲,乙', 3)).toEqual(['甲', '乙', '']);
  });

  it('识别不出空数时退化成单格', () => {
    expect(toBlankValueArray('叶绿体', 0)).toEqual(['叶绿体']);
  });
});

describe('joinFillBlankAnswers', () => {
  it('拼回后端约定的英文逗号整串', () => {
    // 提交协议没变：后端 answerCheck.js 按逗号重新拆段逐空比对
    expect(joinFillBlankAnswers(['甲', '乙'])).toBe('甲,乙');
  });

  it('跳过没填的空，免得提交出「甲,,乙」这种多空标记', () => {
    expect(joinFillBlankAnswers(['甲', '', '乙'])).toBe('甲,乙');
    expect(joinFillBlankAnswers(['甲', '  ', '乙'])).toBe('甲,乙');
    expect(joinFillBlankAnswers([])).toBe('');
  });

  it('与 splitFillBlankAnswer 互为逆运算（单空内含逗号的答案除外，那是题库的问题）', () => {
    const values = ['北京', '上海'];
    expect(splitFillBlankAnswer(joinFillBlankAnswers(values))).toEqual(values);
  });
});