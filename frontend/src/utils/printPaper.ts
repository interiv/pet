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

/** 打印内容的选择 */
export type PrintContent = 'paper' | 'sheet' | 'both';

/**
 * 生成完整打印页 HTML。
 * @param namedStudents 为空数组时输出一份空白卷；多项时每人一页，自动分页。
 * @param content 打印内容：paper=只印试卷　sheet=只印答题卡　both=两者（每人一组）
 */
export function buildPaperHtml(params: {
  assignment: any;
  questions: PaperQuestion[];
  namedStudents?: PaperStudent[];
  showAnswer?: boolean;
  content?: PrintContent;
}): string {
  const { assignment: a, questions, namedStudents = [], showAnswer = false, content = 'paper' } = params;
  const body = buildBodyHtml(a, questions);
  const typeTag = ASSIGNMENT_TYPE_LABEL[a?.assignment_type] || '';
  const wantPaper = content === 'paper' || content === 'both';
  const wantSheet = content === 'sheet' || content === 'both';

  const answers = showAnswer
    ? `<div class="ans-block"><div class="ans-title">参考答案</div><div class="ans-list">${questions
        .map((q: any, i: number) => `<div class="ans-item">${i + 1}. ${escapeHtml(q.answer)}</div>`)
        .join('')}</div></div>`
    : '';

  /**
   * 每名学生一组：[试卷页][答题卡页]。
   * both 模式下答题卡紧跟在该学生的试卷后面，方便一起发下去、按人收上来。
   *
   * 分页不在这里手动插空 div，而是由 CSS 的 page-break-after 统一控制：
   * 每份内容结束都强制换页，最后一份再由 :last-child 取消。
   * 手动插分页符时只在「人和人之间」插，试卷与答题卡之间就没插——
   * 试卷内容不满一页时，答题卡会紧跟着排在同一页的下半部分。
   */
  const blocks: string[] = [];
  const people: Array<PaperStudent | null> = namedStudents.length > 0 ? namedStudents : [null];
  people.forEach((s) => {
    if (wantPaper) {
      blocks.push(
        `<div class="page">${buildHeaderHtml(a, s)}<h2>${escapeHtml(a.title)}${
          typeTag ? `<span class="tag">${typeTag}</span>` : ''
        }</h2>${body}${answers}</div>`
      );
    }
    if (wantSheet) {
      blocks.push(buildAnswerSheetHtml(a, s, questions));
    }
  });
  const pages = blocks.join('');

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
.ans-block { margin-top: 6mm; border-top: 1px dashed #999; padding-top: 3mm; }
.ans-title { font-weight: bold; margin-bottom: 2mm; }
.ans-item { margin: 1mm 0; color: #333; }
/* ===== 答题卡===== */
/* 每一份内容（试卷 .page、答题卡 .page.sheet）结束后都强制换页。
   少了这条，试卷内容不满一页时答题卡会跟着排在同一页下半部分。
   答题卡自身可能跨两页，page-break-after 作用在整块之后，
   也就是只在它最后一页结束时换页，下一页不会混进别的内容。 */
.page, .sheet { page-break-after: always; }
/* 最后一份后面不能再分页，否则打印机要多吐一张空白页 */
.page:last-child, .sheet:last-child { page-break-after: auto; }
.tip { font-size: 11px; color: #666; margin-bottom: 3mm; }
.sec-title { font-weight: bold; margin: 4mm 0 2mm; font-size: 13px; }
.obj { width: 100%; border-collapse: collapse; }
.obj td { border: 1px solid #999; padding: 2.5mm 2mm; font-size: 13px; }
.obj .n { width: 12mm; text-align: center; color: #666; }
.obj .t { width: 26mm; color: #444; }
.obj .a { text-align: center; letter-spacing: 2mm; }
.row { display: flex; align-items: baseline; margin: 3mm 0 1mm; }
.row .n { width: 12mm; color: #666; flex-shrink: 0; }
.row .qtext { font-size: 12px; color: #444; }
.blank { display: inline-block; min-width: 60mm; border-bottom: 1px solid #333; }
.write-area { border: 1px solid #bbb; min-height: 26mm; margin: 1mm 0 4mm 12mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 30px, #e5e5e5 30px, #e5e5e5 31px); }
.toolbar { position: fixed; top: 8px; right: 8px; z-index: 99; }
.toolbar button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
@media print { .toolbar { display: none; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">打印</button></div>
${pages}
</body></html>`;
}

/**
 * 生成答题卡 HTML。
 *
 * 为什么需要单独一张：试卷上题量大、留白按题目分布，学生在卷子上写，
 * 老师收上来后逐题判分很慢。答题卡把答案集中到一处（选择/判断涂卡、
 * 主观题写格子），扫卡机或人工快速判分，也方便二次批改。
 *
 * 姓名同样印在页眉——答题卡是按人发的，预填姓名才不会发错。
 */
function buildAnswerSheetHtml(a: any, s: PaperStudent | null, questions: PaperQuestion[]): string {
  const name = s ? escapeHtml(s.real_name || s.username || '') : '____________';
  const no = s?.student_no ? escapeHtml(s.student_no) : '__________';

  // 客观题与主观题分区排布：涂卡区紧凑，作答区留足空间
  const objective = questions
    .map((q, i) => ({ q, no: i + 1 }))
    .filter(({ q }) => q.type === 'choice_single' || q.type === 'choice_multi' || q.type === 'judgment');

  const subjective = questions
    .map((q, i) => ({ q, no: i + 1 }))
    .filter(({ q }) => q.type === 'fill_blank' || q.type === 'essay' || q.type === 'composition');

  const objHtml = objective.length
    ? `<div class="sec-title">一、选择题（请在括号内填答案，或直接涂卡）</div>
       <table class="obj">
         ${objective
           .map(
             ({ no, q }) => `<tr>
               <td class="n">${no}.</td>
               <td class="t">${TYPE_LABEL[q.type] || q.type}</td>
               <td class="a">（&nbsp;&nbsp;&nbsp;&nbsp;）</td>
             </tr>`
           )
           .join('')}
       </table>`
    : '';

  const fillHtml = subjective.filter(({ q }) => q.type === 'fill_blank').length
    ? `<div class="sec-title">二、填空题</div>
       ${subjective
         .filter(({ q }) => q.type === 'fill_blank')
         .map(
           ({ no }) => `<div class="row"><span class="n">${no}.</span>
             <span class="blank"></span></div>`
         )
         .join('')}`
    : '';

  const essayHtml = subjective.filter(({ q }) => q.type !== 'fill_blank').length
    ? `<div class="sec-title">三、主观题（请在下方作答区书写，可写不下时另附纸）</div>
       ${subjective
         .filter(({ q }) => q.type !== 'fill_blank')
         .map(
           ({ no, q }) => `<div class="row"><span class="n">${no}.</span>
             <span class="qtext">${escapeHtml(String(q.content).slice(0, 40))}${String(q.content).length > 40 ? '…' : ''}</span></div>
             <div class="write-area"></div>`
         )
         .join('')}`
    : '';

  return `<div class="page sheet">
    <div class="meta">班级：${escapeHtml(a.class_name || '________')}　　姓名：<span class="nm">${name}</span>　　学号：${no}　　得分：__________</div>
    <h2>${escapeHtml(a.title)}<span class="tag">答题卡</span></h2>
    <div class="tip">请用黑色笔作答，客观题填写括号内或涂卡；主观题请写在作答区内。</div>
    ${objHtml}
    ${fillHtml}
    ${essayHtml}
  </div>`;
}

/** 打开打印窗口并写入内容。autoPrint 为 true 时自动唤起打印对话框。 */
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
