/**
 * 「把长度不可控的文本塞进 antd Tag」的统一修法。
 *
 * 起因：antd 的 Tag 在样式里写死了 white-space: nowrap
 * （见 frontend/node_modules/antd/es/tag/style/index.js 的 genTagStyle）。
 * 于是任何放进 Tag 的长文本都会渲染成不换行的一整行，直接顶破 Modal / Drawer / 列表项
 * 的边界，右边还看不到头。题库题目详情的「正确答案」、作业统计弹窗的答案、纸质登记的
 * 「AI识别原文」都栽在同一处。
 *
 * 收成一个出口而不是各处各写一遍 whiteSpace: 'normal'，理由和 utils/questionTypes
 * 收题型一样：下次有人再往 Tag 里塞文本，不必靠记忆去找上次是怎么写的。
 */

import type { CSSProperties } from 'react';
import { isFillBlankType, normalizeQuestionType } from './questionTypes';
import { splitFillBlankAnswer } from './fillBlank';

/**
 * Tag 里放长文本时必须套一套：
 * - whiteSpace: 'normal'  —— 抵消 antd Tag 自带的 nowrap，否则永远只有一行；
 * - wordBreak: 'break-word' —— 超长英文单词 / 无标点的连续串也能断，不至于横向溢出；
 * - maxWidth: '100%'      —— 约束在父容器内，父容器是 flex 时尤其要显式写，
 *                            否则 flex 子项按内容宽度撑开，还是会溢出。
 *
 * 用法：`<Tag color="green" style={{ ...LONG_TEXT_TAG_STYLE, marginLeft: 8 }}>…</Tag>`
 * 注意别写成 `style={{ marginLeft: 8, ...LONG_TEXT_TAG_STYLE }}` 之外的反序，
 * 后续自定义样式要放在展开之后才能覆盖这里的值。
 */
export const LONG_TEXT_TAG_STYLE: CSSProperties = {
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  maxWidth: '100%',
};

/**
 * 答案的展示文案。
 *
 * - 判断题库里存的是布尔串 true/false，直接吐出来老师和学生还得自己在脑子里翻译，
 *   统一转成「正确 / 错误」；
 * - 填空题一题多空时答案在库里是逗号分隔的整串（见 utils/fillBlank 的 joinFillBlankAnswers），
 *   原样显示成一坨既看不出有几个空、也正好踩中上面那条不换行的坑。
 *   按同一个口径拆格后用「、」连起来，读起来才和题干里的空位对得上。
 */
export function answerDisplayText(answer: unknown, type?: string | null): string {
  const raw = answer == null ? '' : String(answer);
  const t = normalizeQuestionType(type);

  if (t === 'judgment' || t === 'true_false') {
    if (raw === 'true') return '正确';
    if (raw === 'false') return '错误';
    return raw;
  }

  if (isFillBlankType(type)) {
    return splitFillBlankAnswer(answer).join('、') || raw;
  }

  return raw;
}

/**
 * 这道该叫「答案」还是「参考答案」。
 *
 * 填空题答案是 AI 按语义判分、容忍等价写法的参考值，不是机器逐字比对的标准答案，
 * 叫「参考答案」才不会让人误以为差一个字就判错。这与学生端查看结果里的措辞保持一致。
 */
export function answerLabel(type?: string | null): string {
  return isFillBlankType(type) ? '参考答案' : '答案';
}
