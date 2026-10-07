import { describe, it, expect } from 'vitest';
import { isQuestionAnswerable, isQuestionAnswered, AnswerableQuestion } from './answerState';

// 这组用例锁的是一个已经上线的 bug：学生全部做完了，提交却被拦，
// 提示「第 X 题还没作答」。根因是同一个判定被写了四遍、四份规则还不一样。
// 所以下面的断言大多写成「两条路径必须给出同一个结论」，
// 而不只是「某个值等于 true」——分歧本身就是 bug。

const q = (over: Partial<AnswerableQuestion> = {}): AnswerableQuestion => ({
  id: 1,
  type: 'choice_single',
  options: ['A', 'B'],
  ...over,
});

describe('isQuestionAnswerable', () => {
  it('五种能作答的题型都返回 true', () => {
    expect(isQuestionAnswerable(q({ type: 'choice_single' }))).toBe(true);
    expect(isQuestionAnswerable(q({ type: 'choice_multi' }))).toBe(true);
    expect(isQuestionAnswerable(q({ type: 'judgment', options: null }))).toBe(true);
    expect(isQuestionAnswerable(q({ type: 'fill_blank', options: null }))).toBe(true);
    expect(isQuestionAnswerable(q({ type: 'essay', options: null }))).toBe(true);
    expect(isQuestionAnswerable(q({ type: 'composition', options: null }))).toBe(true);
  });

  it('选项为空的选择题算「无法作答」——渲染出来也没有选项可点', () => {
    // 注意不能用 truthy 判断：[] 是 truthy，会放行这道题，
    // 学生看到的是一张只有题干、没有选项的卡片，提交必被拦
    expect(isQuestionAnswerable(q({ type: 'choice_single', options: [] }))).toBe(false);
    expect(isQuestionAnswerable(q({ type: 'choice_multi', options: [] }))).toBe(false);
  });

  it('options 为 null / undefined 的选择题同样算无法作答', () => {
    expect(isQuestionAnswerable(q({ type: 'choice_single', options: null }))).toBe(false);
    expect(isQuestionAnswerable(q({ type: 'choice_single', options: undefined }))).toBe(false);
  });

  it('未知题型算无法作答，好过渲染出一个没有输入框的空卡片', () => {
    expect(isQuestionAnswerable(q({ type: 'true_false', options: null }))).toBe(false);
    expect(isQuestionAnswerable(q({ type: 'mixed', options: null }))).toBe(false);
    expect(isQuestionAnswerable(q({ type: '', options: ['A'] }))).toBe(false);
  });
});

describe('isQuestionAnswered', () => {
  it('选了选项就算作答', () => {
    expect(isQuestionAnswered(q(), { 1: 'A' }, {})).toBe(true);
    expect(isQuestionAnswered(q(), { 1: ['A', 'C'] }, {})).toBe(true);
  });

  it('完全没答算未作答', () => {
    expect(isQuestionAnswered(q(), {}, {})).toBe(false);
    expect(isQuestionAnswered(q(), { 1: undefined }, {})).toBe(false);
    expect(isQuestionAnswered(q(), { 1: null }, {})).toBe(false);
  });

  it('多选题取消所有勾选算未作答', () => {
    // 这正是 bug 现场：Checkbox.Group 取消全部勾选时值为 []，
    // 旧进度条把 [] 当成「已完成」，提交校验却当成「没做」——
    // 于是界面喊「全部完成」、提交又被自己拦下
    expect(isQuestionAnswered(q({ type: 'choice_multi' }), { 1: [] }, {})).toBe(false);
  });

  it('只有空白字符的输入算未作答', () => {
    expect(isQuestionAnswered(q({ type: 'fill_blank' }), { 1: '' }, {})).toBe(false);
    expect(isQuestionAnswered(q({ type: 'fill_blank' }), { 1: '   ' }, {})).toBe(false);
    expect(isQuestionAnswered(q({ type: 'fill_blank' }), { 1: '\n\t ' }, {})).toBe(false);
    expect(isQuestionAnswered(q({ type: 'fill_blank' }), { 1: ' x ' }, {})).toBe(true);
  });

  it('主观题只拍照不打字也算作答（后端本来就是收图片的）', () => {
    const essay = q({ type: 'essay', options: null });
    expect(isQuestionAnswered(essay, {}, { 1: { url: '/uploads/a.jpg' } })).toBe(true);
    expect(isQuestionAnswered(essay, {}, { 1: { url: '' } })).toBe(false);
    expect(isQuestionAnswered(essay, {}, {})).toBe(false);
  });

  it('作文同样支持只拍照', () => {
    const comp = q({ type: 'composition', options: null });
    expect(isQuestionAnswered(comp, {}, { 1: { url: '/uploads/c.jpg' } })).toBe(true);
  });

  it('客观题不认照片：选择题传了图也算没作答', () => {
    // 拍照入口只对主观题渲染，客观题走到这里说明状态已经乱了，
    // 此时应当判未作答，让校验去拦，而不是静默放行一份空答案
    expect(isQuestionAnswered(q(), {}, { 1: { url: '/uploads/x.jpg' } })).toBe(false);
    expect(isQuestionAnswered(q({ type: 'judgment', options: null }), {}, { 1: { url: '/x.jpg' } })).toBe(false);
  });

  it('答案挂在别的题上不算这道题作答（按 q.id 取，不是取第一个）', () => {
    expect(isQuestionAnswered(q({ id: 2 }), { 1: 'A' }, {})).toBe(false);
    expect(isQuestionAnswered(q({ id: 2 }), { 2: 'A', 1: 'B' }, {})).toBe(true);
  });
});

describe('两套判定必须同源', () => {
  // 进度条/里程碑走「渲染不出控件 → 不算这题的分母口径」，
  // 提交校验走「渲染不出控件 → 单独报『无法作答』」，
  // 但对于能作答的题，「算已作答」和「题目本身可作答」不能互相打架。
  it('凡是可作答的题型，都不会因为「答了但被判未答」而在提交被卡住', () => {
    const answerable: AnswerableQuestion[] = [
      q({ id: 1, type: 'choice_single' }),
      q({ id: 2, type: 'choice_multi' }),
      q({ id: 3, type: 'judgment', options: null }),
      q({ id: 4, type: 'fill_blank', options: null }),
      q({ id: 5, type: 'essay', options: null }),
      q({ id: 6, type: 'composition', options: null }),
    ];
    const full: Record<number, any> = { 1: 'A', 2: ['A', 'B'], 3: 'true', 4: 'x', 5: '作文', 6: '作文' };
    for (const item of answerable) {
      expect(isQuestionAnswerable(item), `题型 ${item.type} 应可作答`).toBe(true);
      expect(isQuestionAnswered(item, full, {}), `第 ${item.id} 题应算已作答`).toBe(true);
    }
  });

  it('主观题只拍照时，校验口径与「已完成 N/N」不会再互相矛盾', () => {
    const items: AnswerableQuestion[] = [
      q({ id: 1, type: 'essay', options: null }),
      q({ id: 2, type: 'composition', options: null }),
    ];
    const imgs: Record<number, { url?: string }> = {
      1: { url: '/u/1.jpg' },
      2: { url: '/u/2.jpg' },
    };
    // 进度条分子 = 提交校验认为「已作答」的题数，两者必须相等
    const counted = items.filter((item) => isQuestionAnswered(item, {}, imgs)).length;
    expect(counted).toBe(2);
  });
});