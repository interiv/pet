// 科目选项：教师任教科目、布置作业、课堂做题共用同一份，避免各处列表不一致
export const SUBJECT_OPTIONS = [
  '语文', '数学', '英语', '物理', '化学', '生物',
  '历史', '地理', '政治', '音乐', '体育', '美术',
  '信息技术', '科学', '其他',
];

export const subjectSelectOptions = SUBJECT_OPTIONS.map((s) => ({ value: s, label: s }));

/**
 * 取教师在当前班级的任教科目（留作业 / 课堂做题的默认科目）
 * 优先取当前班级对应的科目，其次取第一个有科目的班级。
 */
export function getMySubject(
  teacherClasses: Array<{ id?: number; subject?: string | null }> | undefined | null,
  classId?: number | null,
): string | undefined {
  if (!teacherClasses || teacherClasses.length === 0) return undefined;
  const matched = classId ? teacherClasses.find((c) => Number(c.id) === Number(classId)) : null;
  const withSubject = matched && matched.subject ? matched : teacherClasses.find((c) => !!c.subject);
  return withSubject?.subject || undefined;
}
