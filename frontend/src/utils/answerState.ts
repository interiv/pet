import { isSubjectiveType, normalizeQuestionType } from './questionTypes';
import { countBlanks, isFillBlankAnswered } from './fillBlank';

/**
 * 「一道题有没有作答」的唯一判定口径。
 *
 * 起因是学生端报过「明明做完了，提交却说没做完」。查下来不是逻辑错，
 * 而是同一个问题在这条链路上被写了四遍、四份规则还不一样：
 *   - 提交校验：空数组算未作答，字符串要 trim，主观题允许「只拍照」
 *   - 进度条：空数组算已完成，不看照片
 *   - 里程碑提示：又一份规则
 *   - 渲染分支：决定有没有输入框
 * 于是进度条显示「已完成 N/N 题」并弹了「🎉 全部完成」，点提交却被拦下。
 *
 * 抽出来是为了让它物理上只有一份：进度条、里程碑、提交校验都必须调这里，
 * 谁再写一遍谁就会重新引入这个 bug。渲染分支也用 isQuestionAnswerable，
 * 保证「有没有输入框」和「算不算作答过」永远同源。
 */

/** 只取判定需要的最小字段，避免这个模块反向依赖组件里的 Question 类型 */
export interface AnswerableQuestion {
  id?: number;
  type: string;
  options?: string[] | null;
  /** 填空题要靠题干里的空位占位符判断该填几空 */
  content?: string | null;
}

/**
 * 该题在学生端是否渲染得出作答控件。
 *
 * 必须和 Assignments.tsx 里 renderQuestionForStudent 的渲染分支保持一致：
 * 渲染不出来却仍计入总题数，学生会遇到「界面上找不到输入框，
 * 提交却被说第 X 题没作答」。
 */
export const isQuestionAnswerable = (q: AnswerableQuestion): boolean => {
  // 题型先归一化：题库里存成 'Fill_Blank' / 'fill_blank ' 的历史脏数据，
  // 原先这里一律判 false，学生既看不到输入框、提交又被拦，
  // 报的还是「题型无法作答，请联系老师」——老师查一圈也查不出是哪的问题。
  const type = normalizeQuestionType(q.type);
  if (isSubjectiveType(type)) return true;
  if (type === 'judgment' || type === 'fill_blank') return true;
  if (type === 'true_false') return true;
  if (type === 'choice_single' || type === 'choice_multi') {
    // 注意是 length > 0 而不是 truthy：[]
    // 渲染分支虽然进得去，但一个选项都渲染不出来，同样等于没法作答
    return Array.isArray(q.options) && q.options.length > 0;
  }
  return false;
};

/**
 * 判断一道题在学生眼里是否算「已作答」。
 *
 * 规则：
 *   1. 有文字答案即算作答（空串/纯空白/空数组都不算）
 *   2. 填空题按「空」算：题干画了几个空就必须填满几个，只填一半算没做完。
 *      这与「答错了」是两件事——提交前就点名提醒，别让学生提交后才发现漏空。
 *   3. 主观题额外允许「只拍照、不打字」——手写作文几百字，学生不会愿意敲；
 *      后端本来就是收图片的（见 POST /:id/submit 的 image_url）
 */
export const isQuestionAnswered = (
  q: AnswerableQuestion,
  studentAnswers: Record<number, any>,
  uploadedImages: Record<number, { url?: string } | undefined>
): boolean => {
  const ans = studentAnswers[q.id!];
  const type = normalizeQuestionType(q.type);

  // 填空题单独走按空判定：数组里每个空都要非空，
  // 逗号整串形态（历史数据）则交给 isFillBlankAnswered 按空数拆开看。
  if (type === 'fill_blank') {
    if (isFillBlankAnswered(ans, countBlanks(q.content))) return true;
    return false;
  }

  const hasText = !(ans === undefined || ans === null
    || (Array.isArray(ans) && ans.length === 0)
    || (typeof ans === 'string' && ans.trim() === ''));
  if (hasText) return true;
  // 题型口径走 utils/questionTypes，不在这里硬编码类型名，
  // 否则题型一增删就只有提交校验会变成「只拍照不算作答」
  const hasImage = !!uploadedImages[q.id!]?.url;
  return hasImage && isSubjectiveType(type);
};