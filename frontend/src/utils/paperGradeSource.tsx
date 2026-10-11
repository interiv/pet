import { Tag, Tooltip } from 'antd';

/**
 * 纸质卷的判分来源标记（共享给单人登记与批量登记两个组件）。
 *
 * 【背景：为什么会有「来源」这种字段】
 * 纸质卷的识别与判分是拆开做的：
 *   - 客观题（单选/多选/判断）由后端拿标准答案规则比对。有唯一答案，比对就是
 *     字符串相等，确定且可复现，和学生在线提交走的是同一套 answerCheck.isAnswerCorrect。
 *   - 填空/简答/作文才调 AI 按语义评阅（AI 调不通时填空题会退回规则比对）。
 * 所以同一张成绩单上，不同题的可靠程度其实不一样。老师复核时需要一眼看出
 * 「哪题是机器算死的、哪题是 AI 估的、哪题必须人工看」——这才是这个标签的用途。
 */
export const GRADE_SOURCE: Record<string, { color: string; text: string; tip: string }> = {
  /** 客观题按标准答案规则比对：结果确定 */
  rule: { color: 'default', text: '规则判', tip: '按标准答案自动比对，结果确定' },
  /** 主观题 AI 语义评阅：有偏差可能，建议老师扫一眼 */
  ai: { color: 'blue', text: 'AI评', tip: 'AI 按语义评阅，建议老师确认' },
  /** AI 调用失败后按参考答案规则兜底：结果确定但非本意，需确认 */
  fallback: { color: 'orange', text: '规则兜底', tip: 'AI 调用失败，已按参考答案比对，请确认' },
  /** 没评出来，只能人工批 */
  failed: { color: 'red', text: '待人工批', tip: 'AI 评阅失败，请老师人工批改' },
};

/**
 * 渲染判分来源标签。
 *
 * 改造之前识别的老批次结果里没有 grade_source 字段（历史数据不会补写），
 * 这时返回 null 不显示——显示「未知」反而会让老师误以为出了故障。
 */
export const gradeSourceTag = (src?: string | null) => {
  if (!src) return null;
  const meta = GRADE_SOURCE[src];
  if (!meta) return null;
  return (
    <Tooltip title={meta.tip}>
      <Tag color={meta.color} style={{ marginRight: 4, cursor: 'help' }}>{meta.text}</Tag>
    </Tooltip>
  );
};
