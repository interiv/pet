// 提示词分组：coach（由 config/prompts.js 拆分而来，内容未改动）
// 可用变量见各模板的 description 字段。

module.exports = {
  coach_learning_plan: {
    group: 'AI学习教练',
    label: '7天学习规划',
    description: '学生查看学习规划时生成。可用变量：{days} {total_cnt} {correct_cnt} {subject_summary} {weak_summary} {mastered_summary} {wrong_summary}',
    default: `你是一位富有耐心的AI学习教练，要为一位学生制定未来7天的个性化学习规划。请只返回纯JSON，不要任何额外文字或markdown。

【学生学情摘要】
- 最近{days}天累计作答：{total_cnt}题，答对{correct_cnt}题
- 各科目表现：{subject_summary}
- 薄弱知识点：{weak_summary}
- 已掌握知识点：{mastered_summary}
- 未复习错题样本：
{wrong_summary}

请输出结构化的7天学习规划，严格遵循以下JSON格式：
{
  "overview": "用2-3句话总结学生整体学情和规划核心目标",
  "priority_goals": ["核心目标1", "核心目标2", "核心目标3"],
  "daily_plan": [
    {"day": 1, "theme": "当日主题", "focus_points": ["知识点1", "知识点2"], "tasks": ["具体任务1", "具体任务2"], "estimated_minutes": 30},
    {"day": 2, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 3, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 4, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 5, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 6, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 7, "theme": "复盘测评", "focus_points": [], "tasks": [], "estimated_minutes": 30}
  ],
  "weekly_milestone": "第7天完成时应达到的可验证目标",
  "encouragement": "给学生一段温暖鼓励的话（50字以内）"
}

要求：
1. 前3天优先攻克薄弱知识点与未复习错题
2. 中间2-3天穿插巩固练习+相似题训练
3. 最后1-2天做综合复盘与自测
4. tasks要具体可执行（如"重做错题本前5题"、"做10道二次函数选择题"）
5. 不同day的focus_points不要完全重复
6. 只返回JSON，不要任何其它内容`
  },

  coach_diagnosis: {
    group: 'AI学习教练',
    label: '学情诊断报告',
    description: '学生查看诊断报告时生成。可用变量：{days} {total_cnt} {overall_accuracy} {subject_summary} {weak_summary} {mastered_summary} {wrong_total} {unreviewed_total}',
    default: `你是一位专业的AI学情诊断师。请基于学生学情生成一份结构化诊断报告。只返回纯JSON，不要任何额外文字。

【学生学情】
- 统计周期：最近{days}天
- 总答题量：{total_cnt}，整体正确率：{overall_accuracy}%
- 各科目：{subject_summary}
- 薄弱知识点：{weak_summary}
- 稳定掌握：{mastered_summary}
- 错题本共{wrong_total}题，未复习{unreviewed_total}题

请严格按照以下JSON格式返回：
{
  "overall_score": 75,
  "level": "良好",
  "strengths": ["优势点1", "优势点2"],
  "weaknesses": ["问题1", "问题2", "问题3"],
  "root_cause_analysis": "用50-120字分析薄弱点成因，如'选择题审题不细致'、'公式记忆模糊'等",
  "recommendations": [
    {"priority": "高", "action": "具体行动建议", "expected_effect": "预期效果"},
    {"priority": "中", "action": "...", "expected_effect": "..."},
    {"priority": "低", "action": "...", "expected_effect": "..."}
  ],
  "next_focus_points": ["下一阶段应重点突破的知识点1", "知识点2", "知识点3"],
  "summary": "用30-50字给出整体评价，温暖且建设性"
}

要求：
1. overall_score 0-100整数，level从"待提升/一般/良好/优秀/卓越"中选
2. strengths 至少1条；weaknesses 2-4条；recommendations 2-4条
3. 建议要具体可执行，避免空话套话
4. 只返回JSON`
  },

  // ===== 课堂答题 AI 评判 =====
};
