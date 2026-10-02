/**
 * 纸质作业纸打印（住校生无设备场景）
 *
 * 老师把预习题/作业打印出来发给学生，学生在纸上作答。
 * 支持两种模式：
 *  - blank：一张空白卷，页眉「姓名：______」，适合临时补打
 *  - named：按班级名单逐人生成，每人一页、页眉预填该生姓名与学号，适合整班统一发放
 */

export interface PaperQuestion {
  id: number;
  content: string;
  type: string;
  options?: string[] | null;
}

export interface PaperStudent {
  id: number;
  real_name?: string;
  username?: string;
  student_no?: string;
}

export type PaperMode = 'blank' | 'named';

const TYPE_LABEL: Record<string, string> = {
  choice_single: '单选题',
  choice_multi: '多选题',
  judgment: '判断题',
  fill_blank: '填空题',
  essay: '简答/主观题',
};

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  preview: '预习题',
  homework: '作业',
  review: '复习题',
};

export const escapeHtml = (s: any) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 只渲染题目区，多份卷共用同一段 HTML */
function buildBodyHtml(a: any, questions: PaperQuestion[]): string {
  const items = questions.map((q, i) => {
    const opts =
      Array.isArray(q.options) && q.options.length > 0
        ? `<div class="opts">${q.options
            .map((o: string, oi: number) => `<div class="opt">${String.fromCharCode(65 + oi)}. ${escapeHtml(o)}</div>`)
            .join('')}</div>`
        : '';
    const judgment =
      q.type === 'judgment' ? '<div class="opt">（&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;）对　（&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;）错</div>' : '';
    const answer =
      q.type === 'essay' || q.type === 'fill_blank'
        ? `<div class="answer-lines" style="height:${q.type === 'essay' ? 130 : 70}px"></div>`
        : '';
    return `<div class="q"><div class="qt">${i + 1}. ${escapeHtml(q.content)}　<span class="tt">[${
      TYPE_LABEL[q.type] || q.type
    }]</span></div>${opts}${judgment}${answer}</div>`;
  }).join('');

  const desc = a?.description ? `<div class="desc">${escapeHtml(a.description)}</div>` : '';
  return `${desc}${items}`;
}

/** 单份卷子的页眉 */
function buildHeaderHtml(a: any, s?: PaperStudent | null): string {
  const name = s ? escapeHtml(s.real_name || s.username || '') : '____________';
  const no = s?.student_no ? escapeHtml(s.student_no) : '__________';
  return `<div class="meta">班级：${escapeHtml(a.class_name || '________')}　　姓名：<span class="nm">${name}</span>　　学号：${no}　　得分：__________</div>`;
}

/**
 * 生成完整打印页 HTML。
 * @param namedStudents 为空数组时输出一份空白卷；多项时每人一页，自动分页。
 */
export function buildPaperHtml(params: {
  assignment: any;
  questions: PaperQuestion[];
  namedStudents?: PaperStudent[];
  showAnswer?: boolean;
}): string {
  const { assignment: a, questions, namedStudents = [], showAnswer = false } = params;
  const body = buildBodyHtml(a, questions);
  const typeTag = ASSIGNMENT_TYPE_LABEL[a?.assignment_type] || '';

  const answers = showAnswer
    ? `<div class="ans-block"><div class="ans-title">参考答案</div><div class="ans-list">${questions
        .map((q: any, i: number) => `<div class="ans-item">${i + 1}. ${escapeHtml(q.answer)}</div>`)
        .join('')}</div></div>`
    : '';

  const pages =
    namedStudents.length > 0
      ? namedStudents
          .map(
            (s, idx) =>
              `<div class="page">${buildHeaderHtml(a, s)}<h2>${escapeHtml(a.title)}${
                typeTag ? `<span class="tag">${typeTag}</span>` : ''
              }</h2>${body}${answers}</div>${
                idx < namedStudents.length - 1 ? '<div class="pb"></div>' : ''
              }`
          )
          .join('')
      : `<div class="page">${buildHeaderHtml(a, null)}<h2>${escapeHtml(a.title)}${
          typeTag ? `<span class="tag">${typeTag}</span>` : ''
        }</h2>${body}${answers}</div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(a.title)} - 作业纸</title><style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; font-size: 12px; color: #222; margin: 0; }
h2 { text-align: center; margin: 0 0 2mm; font-size: 16px; }
.tag { font-size: 11px; font-weight: normal; color: #8b5cf6; border: 1px solid #8b5cf6; border-radius: 3px; padding: 0 3px; margin-left: 4px; vertical-align: middle; }
.meta { margin: 0 0 4mm; font-size: 13px; border-bottom: 1px solid #999; padding-bottom: 2mm; }
.nm { font-weight: bold; }
.desc { color: #555; margin-bottom: 3mm; white-space: pre-wrap; }
.q { margin-bottom: 5mm; page-break-inside: avoid; }
.qt { font-size: 13px; font-weight: bold; margin-bottom: 1mm; line-height: 1.5; }
.tt { font-weight: normal; color: #666; font-size: 11px; }
.opts { margin-left: 6mm; }
.opt { margin: 1mm 0; }
.answer-lines { margin-top: 2mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 30px, #bbb 30px, #bbb 31px); }
.pb { page-break-after: always; }
.ans-block { margin-top: 6mm; border-top: 1px dashed #999; padding-top: 3mm; }
.ans-title { font-weight: bold; margin-bottom: 2mm; }
.ans-item { margin: 1mm 0; color: #333; }
.toolbar { position: fixed; top: 8px; right: 8px; z-index: 99; }
.toolbar button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
@media print { .toolbar { display: none; } .pb { page-break-after: always; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">打印</button></div>
${pages}
</body></html>`;
}

/**
 * 打开打印窗口并写入内容。autoPrint 为 true 时自动唤起打印对话框。
 * 打印只在调用方这一个触发点执行，避免页内脚本 + 外部兜底造成弹两次。
 * 返回 false 表示被浏览器拦截了弹窗。
 */
export function openPaperPrintWindow(html: string, autoPrint = true): boolean {
  const w = window.open('', '_blank', 'width=860,height=680');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  if (autoPrint) {
    // 等字体/布局稳定后再唤起，否则首屏可能缺字
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch (e) {
        /* 忽略：用户手动打印即可 */
      }
    }, 600);
  }
  return true;
}
