import React, { useEffect, useRef, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  message, Space, Tag, Tabs, Descriptions, Row, Col, Typography,
  List, Avatar, Popconfirm, Empty, Badge, Spin, Radio, Checkbox, Alert, Upload, Progress
} from 'antd';
import {
  PlusOutlined, GiftOutlined, CheckCircleOutlined,
  UserOutlined, EyeOutlined, PlayCircleOutlined, RobotOutlined,
  UserSwitchOutlined, SearchOutlined, DeleteOutlined, CodeOutlined,
  CopyOutlined, DownloadOutlined, UploadOutlined,
  KeyOutlined, ApiOutlined, LoadingOutlined, HistoryOutlined
} from '@ant-design/icons';
import { classroomQuizAPI, questionBankAPI, itemAPI, equipmentAPI, adminAPI, agentTokenAPI, agentAPI } from '../utils/api';
import { pollAiTask, AI_TASK_URLS } from '../utils/aiTask';
import { readPendingQuizGen, writePendingQuizGen, clearPendingQuizGen } from '../utils/quizTaskResume';
import RewardLogDrawer from './RewardLogDrawer';
import { useAuthStore } from '../store/authStore';
import { getPetThumbUrl } from '../utils/petImage';
import { getMySubject, SUBJECT_OPTIONS } from '../utils/subjects';
import { SOCKET_URL } from '../utils/apiBase';
import ClassroomConsole from './ClassroomConsole';

const { Title, Text, Paragraph } = Typography;

const REWARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币', color: 'gold' },
  item: { label: '物品', color: 'green' },
  equipment: { label: '装备', color: 'blue' },
  exp: { label: '经验', color: 'orange' },
};

const subjectOptions = SUBJECT_OPTIONS;
const aiTypeOptions = [
  { value: 'choice_single', label: '单选题' },
  { value: 'choice_multi', label: '多选题' },
  { value: 'judgment', label: '判断题' },
  { value: 'essay', label: '简答题' }
];

// ===== AI 工具录入：给 AI 用的提示词 / Skill =====
// 教师把这段提示词（或下载的 skill 文件）交给 AI，AI 按约定格式产出题目数据，
// 再粘贴回本页即可批量导入；HTML 课件可选，没有就留空字符串。
const AI_IMPORT_PROMPT = `你是我的出题助手，请为课堂随堂练习出题。

【输出要求】
只输出一个 JSON 对象（不要包裹 markdown 代码块、不要多余解释），格式如下：
{
  "title": "本次练习标题",
  "subject": "科目，如：数学",
  "questions": [
    {
      "question_text": "题干（必填，纯文本，可含换行）",
      "answer_text": "参考答案（可选）",
      "courseware_html": "该题目的 HTML 课件（可选，没有就填空字符串）"
    }
  ]
}

【课件要求】
- courseware_html 是一个**完整独立的 HTML 文档字符串**（以 <!DOCTYPE html> 开头），可直接用 iframe 打开。
- 课件要能帮助学生理解并思考这道题：可以有图示、可交互的小动画/拖拽/点击反馈等。
- 不要引用外部网络资源（离线可用），样式与脚本都写在同一个 HTML 里。

【我的需求】
`;

const AI_IMPORT_SKILL_MD = `# 课堂做题题目生成（课堂宠物养成系统）

## 用途
按固定 JSON 格式为「课堂做题」批量生成题目，可附带可交互的 HTML 课件。

## 使用方式
1. 在对话中告诉我：科目、年级/班级、知识点、题目数量、难度、是否需要课件。
2. 只输出下列 JSON（不要 markdown 代码块、不要解释文字）：

\`\`\`json
{
  "title": "第三单元随堂练习",
  "subject": "数学",
  "questions": [
    {
      "question_text": "题干文本",
      "answer_text": "参考答案",
      "courseware_html": "<!DOCTYPE html>...</html>"
    }
  ]
}
\`\`\`

## 字段说明
- question_text：必填，题干纯文本。
- answer_text：可选，参考答案，只给老师看。
- courseware_html：可选，完整独立的 HTML 文档字符串（以 <!DOCTYPE html> 开头），
  离线可用、不引用外部资源，用于课堂上展示并让学生操作后思考作答。

## 产出后
把 JSON 粘贴回系统「课堂做题 → 创建 → AI 工具录入」文本框，点「解析预览」即可导入。
`;

/** AI 直连接入文档：把接口地址与令牌写进 skill，AI 拿到就能直接调后端 */
function buildAgentSkillDoc(baseUrl: string, token: string) {
  return `# 课堂做题题目 · AI 直连接入（课堂宠物养成系统）

> 你可以**直接调用后端接口提交题目**，不需要把题目以文本形式交回给用户。

## 接入信息（已配好）
- 接口根地址：\`${baseUrl}\`
- 令牌：\`${token}\`
- 鉴权：所有请求都要带头 \`X-Agent-Token: ${token}\`
  （也兼容 \`Authorization: Bearer ${token}\`）
- 请求/响应均为 \`application/json\`，UTF-8

## 第一步：确认身份
\`GET ${baseUrl}/whoami\` →
- \`teacher\`：你当前代表的老师
- \`classes\`：可写入的班级（\`role\`=head_teacher/teacher，\`subject\`=该班任教科目）
- \`default_subject\`：**提交题目时 subject 默认用这个值**，除非老师明确要求换科目
- \`default_class_id\`：老师只带一个班时直接用；带多个班必须先问老师用哪个班

## 能做什么
| 需求 | 请求 |
| --- | --- |
| 出题并直接创建课堂做题 | \`POST ${baseUrl}/classroom-quizzes\` |
| 给已有课堂做题补题 | \`POST ${baseUrl}/classroom-quizzes/{quiz_id}/questions\` |
| 只预检不落库（dry_run） | 上面两个接口体里加 \`"dry_run": true\` |
| 查已有课堂做题 | \`GET ${baseUrl}/classroom-quizzes\` |
| 看某场做题详情 | \`GET ${baseUrl}/classroom-quizzes/{quiz_id}\` |
| 复用题库现成题 | \`GET ${baseUrl}/question-bank?subject=数学&keyword=分数\` |
| 读接口自述 | \`GET ${baseUrl}/\` |

## 提交格式
\`\`\`json
{
  "title": "分数加减法随堂练习",
  "subject": "数学",
  "class_id": 7,
  "description": "课堂抢答，答对发宠物道具",
  "questions": [
    { "question_text": "一个三角形有几个角？", "answer_text": "3 个" },
    { "question_text": "计算 1/2 + 1/3 = ?", "answer_text": "5/6", "courseware_html": "<!DOCTYPE html>...</html>" }
  ]
}
\`\`\`

- \`question_text\` 必填，最长 2000 字
- \`answer_text\` 可选，参考答案，只给老师看
- \`courseware_html\` **可选**：完整独立的 HTML 文档（以 \`<!DOCTYPE html>\` 开头），上限 200KB
  - 必须离线可用：样式与脚本写在同一个 HTML 里，不要引用外部网络资源
  - 可以放图示、动画、可点/可拖的小实验：学生先操作课件、思考，再回到题目作答
  - **课件不是必须的**，没有也能正常提交

## 推荐工作流程
1. \`GET /whoami\` 拿到身份、班级、任教科目
2. 老师想先看 → 用 \`"dry_run": true\` 预检，把要提交的内容复述给老师确认
3. 确认后正式 \`POST /classroom-quizzes\`，返回 \`quiz_id\`
4. 继续补题 → \`POST /classroom-quizzes/{quiz_id}/questions\`
5. 提交成功后告诉老师「已创建第 N 场课堂做题，共 X 道题，其中 Y 道带课件」

## 示例（curl）
\`\`\`bash
curl -X POST ${baseUrl}/classroom-quizzes \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Token: ${token}" \\
  -d '{
    "title": "分数加减法随堂练习",
    "subject": "数学",
    "questions": [
      { "question_text": "1/2 + 1/3 = ?", "answer_text": "5/6",
        "courseware_html": "<!DOCTYPE html><html><body><h1>课件</h1></body></html>" }
    ]
  }'
\`\`\`

## 约束与注意
- 一次最多 50 道题；建议单次不超过 20 道，超了就分批追加
- 只能写入令牌所属老师任教的班级，写到别的班会返回 403
- 令牌等同老师身份：**不要外传、不要提交到公开仓库**；老师吊销后立即失效
- 令牌失效返回 401（提示 \`令牌无效或已被吊销\`），此时让老师到
  「课堂做题 → 创建 → AI 工具录入 → 方式一」重新生成令牌
- 提交题目**不消耗** AI 生成额度；只有系统内的「AI 出题」功能才消耗
`;
}

// HTML 课件起手模板：教师点「插入模板」就有可改的骨架
const COURSEWARE_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>课堂课件</title>
<style>
  body { font-family: "Microsoft YaHei", system-ui, sans-serif; padding: 24px; color: #222; background: #fff; }
  h2 { color: #1677ff; }
  .tip { background: #f6f8fa; border-left: 4px solid #1677ff; padding: 12px 16px; margin: 16px 0; }
  button { padding: 8px 16px; font-size: 16px; border-radius: 6px; border: 1px solid #1677ff; background: #1677ff; color: #fff; cursor: pointer; }
  #out { margin-top: 16px; font-size: 18px; }
</style>
</head>
<body>
  <h2>课件标题</h2>
  <div class="tip">在这里放图示、动画或可操作的小实验，学生看完后再作答。</div>
  <button onclick="document.getElementById('out').textContent = '操作成功：' + new Date().toLocaleTimeString()">点我试一试</button>
  <div id="out"></div>
</body>
</html>`;

/** 从 AI 返回的文本里解析题目（支持纯 JSON、被文字包裹的 JSON、questions 数组） */
function parseImportedQuestions(raw: string): { questions: any[]; meta: any } {
  const text = String(raw || '').trim();
  if (!text) return { questions: [], meta: {} };

  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // AI 常在 JSON 前后附带说明文字，这里把第一段 JSON 抠出来
    const start = text.search(/[[{]/);
    if (start >= 0) {
      const isArray = text[start] === '[';
      const end = isArray ? text.lastIndexOf(']') : text.lastIndexOf('}');
      if (end > start) {
        try {
          data = JSON.parse(text.slice(start, end + 1));
        } catch {
          data = null;
        }
      }
    }
  }
  if (!data) {
    throw new Error('没能识别出 JSON，请确认内容里包含 { } 或 [ ] 格式的题目数据');
  }

  const list = Array.isArray(data) ? data : (Array.isArray(data.questions) ? data.questions : null);
  if (!list) throw new Error('JSON 里没有找到 questions 数组');

  const questions = list.map((item: any) => {
    if (typeof item === 'string') {
      return { question_text: item.trim(), answer_text: '', courseware_html: '' };
    }
    const q = item || {};
    return {
      question_text: String(q.question_text ?? q.question ?? q.content ?? q.stem ?? q.title ?? '').trim(),
      answer_text: String(q.answer_text ?? q.answer ?? q.reference_answer ?? '').trim(),
      courseware_html: String(q.courseware_html ?? q.courseware ?? q.html ?? '').trim(),
    };
  }).filter((q: any) => q.question_text);

  return { questions, meta: Array.isArray(data) ? {} : data };
}

const statusMap: Record<string, { color: string; label: string }> = {
  active: { color: 'processing', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  cancelled: { color: 'default', label: '已取消' },
};

const renderStatus = (s: string) => (
  <Badge status={statusMap[s]?.color as any} text={statusMap[s]?.label || s} />
);

const ClassroomQuiz: React.FC = () => {
  const { currentClass, user } = useAuthStore();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  // 跨课堂的奖励发放记录抽屉
  const [rewardLogOpen, setRewardLogOpen] = useState(false);
  // 从课堂详情打开记录时带上「只看这一场」的预置筛选
  const [rewardLogPreset, setRewardLogPreset] = useState<{ quizId?: number; classId?: number }>({});
  const [selectedQuiz, setSelectedQuiz] = useState<any>(null);
  const [quizDetail, setQuizDetail] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rewarding, setRewarding] = useState(false);
  const [createForm] = Form.useForm();
  const [rewardForm] = Form.useForm();
  const rewardType = Form.useWatch('reward_type', rewardForm);
  const aiMode = Form.useWatch('ai_mode', createForm) || 'topic';
  // AI 出题的「题型 + 题目数量」分组：一行一条，可加号添加
  const aiBatches: any[] = Form.useWatch('ai_batches', createForm) || [];
  const aiBatchTotal = aiBatches.reduce((sum, b) => sum + (Math.max(1, parseInt(b?.count) || 0) || 0), 0);

  // 创建：班级 / 题目来源
  const [classes, setClasses] = useState<any[]>([]);
  const [createSource, setCreateSource] = useState<'manual' | 'bank' | 'ai' | 'ai_import'>('manual');
  // 手工录入两种写法：逐题录入（可带 HTML 课件）/ 纯文本批量
  const [manualMode, setManualMode] = useState<'rows' | 'text'>('rows');
  const manualRows: any[] = Form.useWatch('manual_questions', createForm) || [];

  // 教师自己的任教科目：创建时默认带出，可手动改
  const mySubject = getMySubject(user?.teacher_classes, currentClass?.id);

  /**
   * 班级默认值：优先「上次用过的班」→ 其次 store 里的当前班→ 最后第一个任教班。
   * 教师通常没有 currentClass（那是学生用的），原先默认值恒为空导致每次都要手选。
   */
  const defaultClassId = (() => {
    const last = Number(localStorage.getItem('classroom_quiz_last_class') || 0);
    const mine = (user?.teacher_classes || []).map((c: any) => Number(c.id));
    if (last && mine.includes(last)) return last;
    if (currentClass?.id && mine.includes(Number(currentClass.id))) return Number(currentClass.id);
    return mine[0];
  })();

  // 记住老师上次用的班：老师一改班级就记下来，下次创建直接落在同一个班
  const handleQuizClassChange = (changed: any) => {
    if (changed && changed.class_id) {
      localStorage.setItem('classroom_quiz_last_class', String(changed.class_id));
    }
  };

  // 题目课件编辑
  const [coursewareIndex, setCoursewareIndex] = useState<number | null>(null);
  const [coursewareDraft, setCoursewareDraft] = useState('');

  // AI 工具录入：粘贴 AI 产出的 JSON（可带 HTML 课件）
  const [importText, setImportText] = useState('');
  const [importedQuestions, setImportedQuestions] = useState<any[]>([]);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  // AI 录入两种方式左右分栏展示，避免两种路径的内容堆在同一屏让老师无所适从
  // 方式一（AI 直接提交）里替代「下载 Skill 文件」的轻量安装入口：
  // 只给一个公网地址，AI 助手自己去抓取并完成接入，老师不用手动下载再上传。
  // 做法参考 SkillHub 的「一句话安装」。
  const [aiImportTab, setAiImportTab] = useState<'direct' | 'paste'>('direct');
  // 方式一里的「其它安装方式」（命令行安装 / 下载文件）默认折叠
  const [showMoreInstall, setShowMoreInstall] = useState(false);
  // 方式一里的「接口地址 / 身份令牌」默认折叠：安装地址里已经有了，只在需要手动配置时才展开
  const [showAgentRaw, setShowAgentRaw] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [aiRequirement, setAiRequirement] = useState('');

  // AI 直连（方式一）：教师自己发令牌，AI 带着令牌直接调后端写数据
  const [agentTokenList, setAgentTokenList] = useState<any[]>([]);
  const [agentTokenPlain, setAgentTokenPlain] = useState('');
  const [agentInfo, setAgentInfo] = useState<any>(null);
  const [agentCreating, setAgentCreating] = useState(false);
  const [agentTesting, setAgentTesting] = useState(false);
  // AI 直连接口地址：同源部署就是 当前站点 + /api/agent（配置了独立后端域名时才带域名）
  const [agentBaseUrl] = useState<string>(() => `${SOCKET_URL}/api/agent`);

  // 题库选题
  const [bankQuestions, setBankQuestions] = useState<any[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankPage, setBankPage] = useState(1);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankSubject, setBankSubject] = useState<string | undefined>(undefined);
  const [bankKeyword, setBankKeyword] = useState('');
  const [selectedBankIds, setSelectedBankIds] = useState<number[]>([]);

  // AI 快速出题
  const [aiLoading, setAiLoading] = useState(false);
  // AI 出题进度（后端后台执行，这里轮询刷新）
  const [aiProgress, setAiProgress] = useState<{ percent: number; done: number; total: number; current: string } | null>(null);
  const [aiQuestions, setAiQuestions] = useState<any[]>([]);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());
  /**
   * 「接回上一次未完成的出题」的现场。
   *
   * resumeInFlightRef：轮询已挂着时置位，避免再点一次按钮起两个循环；
   * restoreFormRef：弹窗重新打开、表单挂载之后才回填，出题要求不会白填一遍。
   */
  const quizResumeInFlightRef = useRef(false);
  const quizRestoreFormRef = useRef<{ mode: string; values: any } | null>(null);

  // 奖励：物品 / 装备列表
  const [items, setItems] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<any[]>([]);
  // 「已加载」与「正在加载」要分开：只判断items.length===0 的话，
  // 请求失败时下拉会永远转圈，看起来像还在加载
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [equipmentsLoaded, setEquipmentsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [equipmentsLoading, setEquipmentsLoading] = useState(false);

  // AI生成次数额度（与发布作业共用）
  const [genLimit, setGenLimit] = useState<{ daily_limit: number; daily_used: number; daily_remaining: number; global_tokens_remaining: number } | null>(null);

  // 随机点名
  const [randomOpen, setRandomOpen] = useState(false);
  const [randomRolling, setRandomRolling] = useState(false);
  const [randomName, setRandomName] = useState('');
  const [pickedStudent, setPickedStudent] = useState<any>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 课堂控制台
  const [consoleData, setConsoleData] = useState<{ quiz: any; questions: any[] } | null>(null);

  useEffect(() => {
    loadQuizzes();
    loadClasses();
    loadGenLimit();
  }, []);

  useEffect(() => {
    return () => { if (rollTimer.current) clearInterval(rollTimer.current); };
  }, []);

  // 奖励类型为物品/装备时，懒加载对应列表。
  // 用教师专用的全量接口（/items/all）：原先复用了学生商店货架（/items），
  // 被 shop_enabled 开关和「可售类型」过滤双重拦截，403 又被下面的 catch 吞掉，
  // 表现为选「物品」后下拉一片空白、还一直转圈。加载失败要明确说出来，
  // 否则老师只会以为是自己哪里点错了。
  useEffect(() => {
    if (rewardModalOpen && rewardType === 'item' && !itemsLoaded) {
      setItemsLoading(true);
      itemAPI.getAllItems()
        .then((res: any) => { setItems(res.data.items || []); setItemsLoaded(true); })
        .catch((e: any) => message.error(e?.response?.data?.error || '物品列表加载失败，请稍后重试'))
        .finally(() => setItemsLoading(false));
    }
    if (rewardModalOpen && rewardType === 'equipment' && !equipmentsLoaded) {
      setEquipmentsLoading(true);
      equipmentAPI.getAll()
        .then((res: any) => { setEquipments(res.data.equipments || []); setEquipmentsLoaded(true); })
        .catch((e: any) => message.error(e?.response?.data?.error || '装备列表加载失败，请稍后重试'))
        .finally(() => setEquipmentsLoading(false));
    }
  }, [rewardModalOpen, rewardType, itemsLoaded, equipmentsLoaded]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (e) {
      console.error('加载班级列表失败');
    }
  };

  const loadGenLimit = async () => {
    try {
      const res = await adminAPI.getMyGenLimit();
      setGenLimit(res.data);
    } catch (e) {
      // 静默
    }
  };

  const loadQuizzes = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (currentClass?.id) params.class_id = currentClass.id;
      const res = await classroomQuizAPI.getQuizzes(params);
      setQuizzes(res.data.quizzes || []);
    } catch (e) {
      console.error('加载课堂做题失败:', e);
    } finally {
      setLoading(false);
    }
  };

  // AI 出题的「题型 + 题目数量」分组编辑器：像填写任教关系那样一行一条，可加号添加
  // 「按知识点」「按详细要求」两种模式共用；一次生成只计 1 次额度，合计不超过 20 道
  const renderAiBatchEditor = () => (
    <div style={{ border: '1px dashed #e0e0e0', borderRadius: 8, padding: 10, marginTop: 4 }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>题型与题量（一行一组，AI 会按每组分别出题）</div>
      <Form.List name="ai_batches" initialValue={[{ type: 'choice_single', count: 5 }]}>
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <Space key={field.key} align="center" wrap style={{ display: 'flex', marginBottom: 8 }}>
                <span style={{ width: 58, color: '#666' }}>第 {field.name + 1} 组</span>
                <Form.Item
                  {...field}
                  name={[field.name, 'type']}
                  style={{ marginBottom: 0 }}
                  rules={[{ required: true, message: '请选择题型' }]}
                >
                  <Select style={{ width: 150 }} options={aiTypeOptions} />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'count']}
                  style={{ marginBottom: 0 }}
                  rules={[{ required: true, message: '请填写数量' }]}
                >
                  <InputNumber min={1} max={20} style={{ width: 120 }} suffix="道" />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={fields.length === 1}
                  onClick={() => remove(field.name)}
                />
              </Space>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ type: 'choice_single', count: 3 })}>
              添加一组题型
            </Button>
            <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
              合计 {aiBatchTotal} 道（一次生成只计 1 次额度，最多 5 组、20 道）
            </div>
          </>
        )}
      </Form.List>
    </div>
  );

  const loadBank = async (page = 1) => {
    setBankLoading(true);
    try {
      const res = await questionBankAPI.getQuestions({
        page,
        pageSize: 10,
        subject: bankSubject || undefined,
        keyword: bankKeyword || undefined,
      });
      setBankQuestions(res.data.questions || []);
      setBankTotal(res.data.total || 0);
      setBankPage(page);
    } catch (e) {
      message.error('加载题库失败');
    } finally {
      setBankLoading(false);
    }
  };

  const handleSourceChange = (source: 'manual' | 'bank' | 'ai' | 'ai_import') => {
    setCreateSource(source);
    if (source === 'bank' && bankQuestions.length === 0) {
      loadBank(1);
    }
  };

  /**
   * 出题结果落地：填进题目勾选区并全选。
   * 首次出题和「接回上次未完成的出题」共用，避免两处逻辑漂移。
   */
  const applyGeneratedQuiz = (data: any) => {
    const list = data?.questions || [];
    setAiQuestions(list);
    setAiSelected(new Set(list.map((_: any, i: number) => i)));
    if (data?.notice) {
      message.warning(`${data.notice}，已生成 ${list.length} 道题`);
    } else {
      message.success(`AI整理出 ${list.length} 道题目，请勾选要使用的题目`);
    }
  };

  /**
   * 接回「上一次没走完的出题任务」。
   *
   * 课堂出题动辄一两分钟，老师看到进度条走到一半会顺手叉掉弹窗或切去别的页面。
   * 这时重新点「AI生成题目」只会撞上后端的同类任务互斥（409），
   * 或者干脆另开一个新任务、白扣一次生成额度——而原来那个其实还在好好跑。
   *
   * @returns 是否接上了某个任务；false 表示没有存档/已失效/已在轮询中，调用方可走全新流程。
   */
  const resumePendingQuizGen = async (): Promise<boolean> => {
    if (!user || quizResumeInFlightRef.current) return false;
    const stored = readPendingQuizGen(user.id);
    if (!stored) return false;

    quizResumeInFlightRef.current = true;
    setAiLoading(true);
    setCreateSource('ai');
    setAiProgress({ percent: 0, done: 0, total: stored.total || 1, current: '正在接回上次未完成的出题…' });
    if (!quizRestoreFormRef.current) {
      quizRestoreFormRef.current = { mode: stored.mode, values: stored.formValues };
    }
    try {
      const data = await pollAiTask(stored.taskId, AI_TASK_URLS.classroomQuizTask, setAiProgress);
      // 标记完成但保留存档：老师中途关掉弹窗、甚至刷新页面后回来，
      // 仍能把这批题取回来接着勾选保存，而不是让已出的题和已扣的额度白扔
      writePendingQuizGen(user.id, { ...stored, done: true });
      applyGeneratedQuiz(data);
      return true;
    } catch (e: any) {
      // 任务失效（服务重启/超过保留期）或已失败：清掉存档，
      // 否则老师每次打开都卡在「接回中」，永远走不到正常的新建流程
      clearPendingQuizGen(user.id);
      message.warning(e?.message || '上次未完成的出题已失效，请重新发起');
      return false;
    } finally {
      setAiProgress(null);
      setAiLoading(false);
      quizResumeInFlightRef.current = false;
    }
  };

  /**
   * 点「创建课堂做题」。
   *
   * 不是无脑开一个空白弹窗：上一次没走完的出题（还在跑 / 出完了但没保存）
   * 都要接着继续，而不是清掉重来——那会白等一两分钟，还白扣一次生成额度。
   */
  const openCreateModal = () => {
    loadGenLimit();
    setCreateModalOpen(true);
    const stored = readPendingQuizGen(user?.id);
    if (!stored) return;
    setCreateSource('ai');
    // 结果还在内存里就别再查一遍后端了
    if (stored.done && aiQuestions.length > 0) return;
    resumePendingQuizGen();
  };

  const handleGenerateAI = async () => {
    // 上一次出题还在后台跑：接回同一个任务看进度，不要重新提交
    const stored = readPendingQuizGen(user?.id);
    if (stored && !stored.done) {
      if (await resumePendingQuizGen()) {
        message.info('已接回刚才未完成的出题，正在显示它的进度');
      }
      return;
    }

    const values = createForm.getFieldsValue(['subject', 'ai_mode', 'ai_topic', 'ai_requirements', 'ai_raw_text', 'ai_type', 'ai_count', 'ai_difficulty', 'ai_batches']);
    if (!values.subject) { message.warning('请先选择科目'); return; }
    const mode = values.ai_mode || 'topic';

    // 题型分组：一行一条「题型 + 题目数量」，像填写任教关系那样可加号添加
    // （粘贴题目模式由素材决定题量，不需要分组）
    const batches: Array<{ type: string; count: number }> = (values.ai_batches || [])
      .map((b: any) => ({ type: b?.type || 'choice_single', count: Math.max(1, parseInt(b?.count) || 1) }))
      .filter((b: any) => b.type);
    if (mode !== 'paste') {
      if (batches.length === 0) { message.warning('请至少添加一组「题型 + 题目数量」'); return; }
      if (batches.length > 5) { message.warning('一次最多出 5 组题型'); return; }
      const total = batches.reduce((s, b) => s + b.count, 0);
      if (total > 20) { message.warning(`一次最多生成 20 道题，当前合计 ${total} 道，请减少数量`); return; }
    }

    const payload: any = {
      subject: values.subject,
      question_type: values.ai_type || 'choice_single',
      count: values.ai_count || 5,
      difficulty: values.ai_difficulty || 'medium',
      mode,
    };
    if (mode === 'topic') {
      if (!values.ai_topic) { message.warning('请输入知识点主题'); return; }
      payload.topic = values.ai_topic;
      payload.batches = batches;
    } else if (mode === 'requirements') {
      if (!values.ai_requirements || !values.ai_requirements.trim()) { message.warning('请填写详细的出题要求'); return; }
      payload.requirements = values.ai_requirements;
      payload.batches = batches;
    } else {
      if (!values.ai_raw_text || !values.ai_raw_text.trim()) { message.warning('请粘贴题目内容'); return; }
      payload.raw_text = values.ai_raw_text;
    }
    setAiLoading(true);
    quizResumeInFlightRef.current = true;
    setAiProgress({ percent: 0, done: 0, total: batches.length || 1, current: '正在提交出题任务' });
    try {
      // 后端改为后台任务：提交只返回 task_id，出题过程靠轮询拿进度
      const res = await classroomQuizAPI.aiGenerate(payload, 30);
      const taskId: string | undefined = res.data?.task_id;
      if (!taskId) throw new Error('后端未返回任务号，请确认服务端已更新到最新版本');

      // 拿到任务号就立刻存档：中途叉掉弹窗、切页面、刷新，回来都接得上
      const archive = {
        taskId,
        mode,
        formValues: { ...values },
        total: batches.length || 1,
        done: false,
        createdAt: Date.now(),
      };
      writePendingQuizGen(user?.id, archive);

      const data = await pollAiTask(taskId, AI_TASK_URLS.classroomQuizTask, setAiProgress);
      // 跑完也留着存档（标记 done）：老师关掉弹窗再回来能把这批题取回来接着勾选保存
      writePendingQuizGen(user?.id, { ...archive, done: true });
      applyGeneratedQuiz(data);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409 && e?.response?.data?.task_id) {
        // 后端的同类任务互斥：上一次那个任务其实还在跑。
        // 不当作错误报给老师，直接接回它看进度——这正是老师点第二次时最需要的
        writePendingQuizGen(user?.id, {
          taskId: e.response.data.task_id,
          mode,
          formValues: { ...values },
          total: batches.length || 1,
          done: false,
          createdAt: Date.now(),
        });
        message.warning('已有一个出题任务正在进行，已为你接上它的进度');
        if (await resumePendingQuizGen()) return;
      } else {
        clearPendingQuizGen(user?.id);
        message.error(e?.response?.data?.error || e?.message || 'AI出题失败');
      }
    } finally {
      setAiProgress(null);
      setAiLoading(false);
      quizResumeInFlightRef.current = false;
      loadGenLimit();
    }
  };

  const handleCreate = async (values: any) => {
    try {
      let questions: any[] = [];

      if (createSource === 'manual') {
        if (manualMode === 'rows') {
          // 逐题录入：题干 + 参考答案（选填）+ HTML 课件（选填）
          questions = (values.manual_questions || [])
            .filter((q: any) => q && String(q.question_text || '').trim())
            .map((q: any) => ({
              question_text: String(q.question_text).trim(),
              answer_text: String(q.answer_text || '').trim() || undefined,
              courseware_html: String(q.courseware_html || '').trim() || undefined,
            }));
        } else {
          questions = (values.question_texts || '')
            .split('\n')
            .filter((line: string) => line.trim())
            .map((text: string) => ({ question_text: text.trim() }));
        }
      } else if (createSource === 'ai_import') {
        questions = importedQuestions
          .filter((_, i) => importSelected.has(i))
          .map((q: any) => ({
            question_text: q.question_text,
            answer_text: q.answer_text || undefined,
            courseware_html: q.courseware_html || undefined,
          }));
      } else if (createSource === 'bank') {
        if (selectedBankIds.length === 0) {
          message.warning('请先从题库中勾选题目');
          return;
        }
        questions = selectedBankIds
          .sort((a, b) => a - b)
          .map(id => {
            const q = bankQuestions.find(b => b.id === id);
            const lines = [q?.content || ''];
            if (q?.options && Array.isArray(q.options) && q.options.length > 0) {
              q.options.forEach((opt: string, i: number) => {
                lines.push(`${String.fromCharCode(65 + i)}. ${opt}`);
              });
            }
            return { question_text: lines.filter(Boolean).join('\n') };
          });
      } else {
        if (aiSelected.size === 0) {
          message.warning('请先点击"AI生成题目"并勾选要使用的题目');
          return;
        }
        questions = aiQuestions
          .filter((_, i) => aiSelected.has(i))
          .map(q => ({ question_text: q.content, answer_text: q.answer || undefined }));
      }

      if (questions.length === 0) {
        message.warning('请至少准备一道题目');
        return;
      }

      await classroomQuizAPI.createQuiz({
        title: values.title,
        description: values.description,
        subject: values.subject,
        class_id: values.class_id || currentClass?.id,
        questions,
      });

      const coursewareCount = questions.filter((q: any) => q.courseware_html).length;
      message.success(coursewareCount > 0
        ? `课堂做题创建成功，其中 ${coursewareCount} 道题带 HTML 课件`
        : '课堂做题创建成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      setCreateSource('manual');
      setManualMode('rows');
      setSelectedBankIds([]);
      setAiQuestions([]);
      setAiSelected(new Set());
      setImportText('');
      setImportedQuestions([]);
      setImportSelected(new Set());
      loadQuizzes();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '创建失败');
    }
  };

  // ===== 题目 HTML 课件 =====
  const openCoursewareEditor = (index: number) => {
    const rows = createForm.getFieldValue('manual_questions') || [];
    setCoursewareIndex(index);
    setCoursewareDraft((rows[index]?.courseware_html) || '');
  };

  const saveCourseware = () => {
    if (coursewareIndex === null) return;
    createForm.setFieldValue(['manual_questions', coursewareIndex, 'courseware_html'], coursewareDraft);
    setCoursewareIndex(null);
    message.success('课件已保存到该题目');
  };

  /** 读取本地文件内容（课件 .html / AI 产出的 .json 都走这里） */
  const readFileAsText = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });

  const handleUploadCourseware = async (file: File, index: number) => {
    try {
      const text = await readFileAsText(file);
      createForm.setFieldValue(['manual_questions', index, 'courseware_html'], text);
      message.success(`已把 ${file.name} 作为第 ${index + 1} 题的课件`);
    } catch {
      message.error('课件文件读取失败');
    }
    return false; // 阻止 antd 自动上传
  };

  // ===== AI 工具录入 =====
  const copyText = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(tip);
    } catch {
      message.warning('浏览器禁止了自动复制，请手动选中文本框内容复制');
    }
  };

  const downloadSkill = () => {
    const blob = new Blob([AI_IMPORT_SKILL_MD], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '课堂做题-AI录入-skill.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParseImport = (text?: string) => {
    const raw = text ?? importText;
    try {
      const { questions: parsed, meta } = parseImportedQuestions(raw);
      if (parsed.length === 0) {
        message.warning('没有解析到任何题目');
        return;
      }
      setImportedQuestions(parsed);
      setImportSelected(new Set(parsed.map((_: any, i: number) => i)));
      // AI 顺带给了标题/科目就一并填进表单，省得老师再输一遍
      if (meta?.title) createForm.setFieldValue('title', meta.title);
      if (meta?.subject) createForm.setFieldValue('subject', meta.subject);
      message.success(`解析到 ${parsed.length} 道题，请勾选要使用的题目`);
    } catch (e: any) {
      message.error(e?.message || '解析失败，请检查内容格式');
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      // 纯 HTML 文件：整份作为一道题的课件；其余按 JSON 解析
      if (/\.html?$/i.test(file.name) && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        setImportText(text);
        setImportedQuestions([{ question_text: `见课件：${file.name}`, answer_text: '', courseware_html: text }]);
        setImportSelected(new Set([0]));
        message.success('已把该 HTML 作为一道题的课件导入，可在下方修改题干');
        return false;
      }
      setImportText(text);
      handleParseImport(text);
    } catch {
      message.error('文件读取失败');
    }
    return false;
  };

  // ===== AI 直连：令牌管理 =====
  const loadAgentTokens = async () => {
    try {
      const res = await agentTokenAPI.list();
      setAgentTokenList(res.data.tokens || []);
    } catch (e) {
      // 非教师身份或网络异常时静默处理
    }
  };

  const handleCreateAgentToken = async () => {
    setAgentCreating(true);
    try {
      const res = await agentTokenAPI.create('AI 助手');
      setAgentTokenPlain(res.data.token);
      message.success('令牌已生成，请立刻复制保存（只显示这一次）');
      await loadAgentTokens();
      await testAgentConnect(res.data.token);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '生成令牌失败');
    } finally {
      setAgentCreating(false);
    }
  };

  const handleRevokeAgentToken = async (id: number) => {
    try {
      await agentTokenAPI.revoke(id);
      setAgentTokenPlain('');
      setAgentInfo(null);
      message.success('令牌已吊销');
      loadAgentTokens();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '吊销失败');
    }
  };

  const testAgentConnect = async (token?: string) => {
    const t = (token || agentTokenPlain || '').trim();
    if (!t) {
      message.warning('请先生成令牌');
      return;
    }
    setAgentTesting(true);
    try {
      const res = await agentAPI.whoami(t);
      setAgentInfo(res.data);
      message.success('连接成功，AI 现在可以直接提交题目了');
    } catch (e: any) {
      setAgentInfo(null);
      message.error(e?.response?.data?.error || '连接失败，请检查令牌是否正确');
    } finally {
      setAgentTesting(false);
    }
  };

  // Skill 安装文档的公网地址：AI 助手自己抓这个地址就能读到全部接入说明，
  // 因此老师不需要手动下载文件再上传（与 SkillHub 的「一句话安装」一致）
  const skillInstallUrl = agentTokenPlain
    ? `${window.location.origin}/api/skills/install/classroom-quiz?token=${encodeURIComponent(agentTokenPlain)}`
    : '';

  /** 一句话安装指令：复制给AI 助手，它会自己去读地址并完成接入 */
  const oneLineInstallPrompt = skillInstallUrl
    ? `请根据 ${skillInstallUrl} 安装「课堂做题题目生成」技能，读完后按文档说明接入，之后我出题时你直接提交到系统。`
    : '';

  /** 命令行安装：让能执行命令的助手把文档落到自己的 skills 目录 */
  const cliInstallCommand = skillInstallUrl
    ? `mkdir -p ~/.workbuddy/skills/classroom-quiz && curl -fsSL "${skillInstallUrl}" -o ~/.workbuddy/skills/classroom-quiz/SKILL.md`
    : '';

  const downloadAgentSkill = () => {
    if (!agentTokenPlain) {
      message.warning('令牌明文只在生成时显示，请先点「生成令牌」再下载');
      return;
    }
    const doc = buildAgentSkillDoc(agentBaseUrl, agentTokenPlain);
    const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '课堂做题-AI直连-skill.md';
    a.click();
    URL.revokeObjectURL(url);
    message.success('已下载，交给 AI 助手即可接入');
  };

  // 打开「AI 工具录入」时拉一次令牌列表
  useEffect(() => {
    if (createSource === 'ai_import') loadAgentTokens();
  }, [createSource]);

  const handleViewDetail = async (quiz: any) => {
    setSelectedQuiz(quiz);
    setDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      setQuizDetail(res.data.quiz);
      setQuestions(res.data.questions || []);
      setRewards(res.data.rewards || []);
      setAnswers(res.data.answers || []);
    } catch (e) {
      console.error('加载详情失败:', e);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCompleteQuiz = async (quizId: number) => {
    try {
      await classroomQuizAPI.updateQuizStatus(quizId, 'completed');
      message.success('课堂做题已结束');
      loadQuizzes();
      if (detailModalOpen) {
        handleViewDetail(selectedQuiz);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败');
    }
  };

  // 进入课堂控制台
  const handleOpenConsole = async (quiz: any) => {
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      const qs = res.data.questions || [];
      if (qs.length === 0) {
        message.warning('该课堂做题暂无题目，请先添加题目');
        return;
      }
      setDetailModalOpen(false);
      setConsoleData({ quiz: res.data.quiz || quiz, questions: qs });
    } catch (e) {
      message.error('加载课堂做题失败');
    }
  };

  // 随机点名
  const startRandomPick = async () => {
    let pool = students;
    try {
      const res = await classroomQuizAPI.getClassStudents(currentClass?.id || selectedQuiz?.class_id);
      pool = res.data.students || [];
      setStudents(pool);
    } catch (e) {
      // 拉取失败时用已有列表
    }
    if (!pool || pool.length === 0) {
      message.warning('班级暂无学生，无法随机点名');
      return;
    }
    setRandomOpen(true);
    setRandomRolling(true);
    setPickedStudent(null);
    let ticks = 0;
    const totalTicks = 25;
    if (rollTimer.current) clearInterval(rollTimer.current);
    rollTimer.current = setInterval(() => {
      const s = pool[Math.floor(Math.random() * pool.length)];
      setRandomName(s.real_name || s.username);
      ticks++;
      if (ticks >= totalTicks && rollTimer.current) {
        clearInterval(rollTimer.current);
        rollTimer.current = null;
        setRandomRolling(false);
        setPickedStudent(s);
      }
    }, 90);
  };

  const handleRewardPicked = () => {
    if (!pickedStudent) return;
    setRandomOpen(false);
    setSelectedStudent(pickedStudent);
    setSelectedQuestionId(null);
    setRewardModalOpen(true);
    rewardForm.resetFields();
  };

  const handleOpenReward = async (quiz: any, questionId: number | null = null, preStudent: any = null) => {
    setSelectedQuiz(quiz);
    setSelectedQuestionId(questionId);
    setRewardModalOpen(true);
    rewardForm.resetFields();
    if (preStudent) {
      setSelectedStudent(preStudent);
    } else {
      setSelectedStudent(null);
    }

    try {
      const res = await classroomQuizAPI.getClassStudents(currentClass?.id || quiz.class_id);
      setStudents(res.data.students || []);
    } catch (e) {
      console.error('加载学生失败:', e);
    }
  };

  const handleReward = async (values: any) => {
    if (!selectedStudent) {
      message.warning('请选择一个学生');
      return;
    }

    setRewarding(true);
    try {
      await classroomQuizAPI.rewardStudent(selectedQuiz.id, {
        student_id: selectedStudent.id,
        pet_id: selectedStudent.pet_id || undefined,
        reward_type: values.reward_type,
        reward_value: values.reward_value,
        reward_name: values.reward_name || undefined,
        question_id: selectedQuestionId || undefined,
        reason: values.reason || undefined,
      });

      message.success(`已向 ${selectedStudent.real_name || selectedStudent.username} 发放奖励`);
      setRewardModalOpen(false);
      setSelectedStudent(null);
      setSelectedQuestionId(null);

      if (detailModalOpen) {
        handleViewDetail(selectedQuiz);
      }
      loadQuizzes();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    } finally {
      setRewarding(false);
    }
  };

  const quizColumns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (v: string) => v || '-' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name' },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count' },
    { title: '奖励次数', dataIndex: 'reward_count', key: 'reward_count' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => renderStatus(s)
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(r)}>详情</Button>
          {r.status === 'active' && (
            <>
              <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => handleOpenConsole(r)}>控制台</Button>
              <Button type="link" size="small" icon={<GiftOutlined />} onClick={() => handleOpenReward(r)}>奖励</Button>
              <Popconfirm title="确定结束此课堂做题？" onConfirm={() => handleCompleteQuiz(r.id)}>
                <Button type="link" size="small" icon={<CheckCircleOutlined />}>结束</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      )
    },
  ];

  const rewardColumns = [
    { title: '学生', dataIndex: 'student_name', key: 'student_name' },
    { title: '宠物', dataIndex: 'pet_name', key: 'pet_name', render: (v: string) => v || '-' },
    {
      title: '奖励类型', dataIndex: 'reward_type', key: 'reward_type',
      render: (t: string) => <Tag color={REWARD_TYPES[t]?.color}>{REWARD_TYPES[t]?.label || t}</Tag>
    },
    {
      title: '奖励内容', key: 'reward_content',
      render: (_: any, r: any) => r.reward_name || `${r.reward_type} x${r.reward_value}`
    },
    { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: '发放者', dataIndex: 'awarder_name', key: 'awarder_name' },
    {
      title: '时间', dataIndex: 'awarded_at', key: 'awarded_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
  ];

  const bankColumns = [
    { title: '题干', dataIndex: 'content', key: 'content', ellipsis: true },
    { title: '知识点', dataIndex: 'knowledge_point', key: 'knowledge_point', ellipsis: true, width: 160 },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 70, render: (v: string) => ({ easy: '简单', medium: '中等', hard: '困难' }[v] || v) },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <PlayCircleOutlined style={{ marginRight: 8 }} />
          课堂做题
        </Title>
        <Space>
          {/* 奖励发出去之后要能查：原先只有单场课堂的详情里有记录，
              「一共发了多少、发给谁都查不到」，这里补一个跨课堂的发放记录入口 */}
          <Button icon={<HistoryOutlined />} onClick={() => { setRewardLogPreset({}); setRewardLogOpen(true); }}>
            发放记录
          </Button>
          <Button
            type="primary"
            icon={aiLoading ? <LoadingOutlined /> : <PlusOutlined />}
            onClick={openCreateModal}
          >
            {aiLoading ? '查看出题进度' : '创建课堂做题'}
          </Button>
        </Space>
      </div>

      <Table
        dataSource={quizzes}
        columns={quizColumns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个课堂做题` }}
        size="middle"
      />

      {/* 创建课堂做题 */}
      <Modal
        title="创建课堂做题"
        open={createModalOpen}
        onCancel={() => {
          const wasGenerating = aiLoading;
          setCreateModalOpen(false);
          createForm.resetFields();
          setCreateSource('manual');
          setManualMode('rows');
          setSelectedBankIds([]);
          setAiQuestions([]);
          setAiSelected(new Set());
          setImportText('');
          setImportedQuestions([]);
          setImportSelected(new Set());
          if (wasGenerating) {
            // 出题任务还在后台跑，撤销不了；存档留着，下次打开「创建课堂做题」直接接回它
            message.info('AI 还在后台继续出题，完成后再点「查看出题进度」就能接着用');
          }
        }}
        onOk={() => createForm.submit()}
        width={880}
        destroyOnHidden
        // 每次打开都重新带出任教科目/默认班级：Form.Item 的 initialValue 只在首次挂载时被消费一次，
        // 而 user 是异步从 store 取的，若不在打开时用 setFieldsValue 兜一次，默认值会永远为空
        afterOpenChange={(open) => {
          if (!open) return;
          const preset: any = {};
          if (mySubject) preset.subject = mySubject;
          if (defaultClassId) preset.class_id = defaultClassId;
          if (Object.keys(preset).length > 0) createForm.setFieldsValue(preset);
          // 接回上一次未完成的出题：回填当时填的要求，让老师看到「是在按什么出题」
          const restore = quizRestoreFormRef.current;
          quizRestoreFormRef.current = null;
          if (restore) {
            setCreateSource('ai');
            createForm.setFieldsValue({ ...restore.values });
            return;
          }
          // 题目已经生成出来、只是还没保存：直接回到出题区，别让老师以为白跑了
          const stored = readPendingQuizGen(user?.id);
          if (stored) {
            setCreateSource('ai');
            if (stored.done && !aiQuestions.length) {
              resumePendingQuizGen();
            }
          }
        }}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate} onValuesChange={handleQuizClassChange}>
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：第三单元随堂练习" />
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item
                name="class_id"
                label="用哪个班上课"
                tooltip="这场做题只有该班的学生能看到并参与，所以必须选一个班。默认已选中你任教的班级。"
                rules={[{ required: true, message: '请选择班级' }]}
              >
                <Select placeholder="选择班级" showSearch optionFilterProp="children">
                  {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item
                name="subject"
                label="科目"
                initialValue={mySubject}
                extra={mySubject ? `默认你的任教科目：${mySubject}` : undefined}
              >
                <Select placeholder="选择科目" allowClear>
                  {subjectOptions.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="课堂做题说明" />
          </Form.Item>

          <Form.Item label="题目来源">
            <Radio.Group value={createSource} onChange={(e) => handleSourceChange(e.target.value as any)} buttonStyle="solid">
              <Radio.Button value="manual">手动输入</Radio.Button>
              <Radio.Button value="bank">从题库选择</Radio.Button>
              <Radio.Button value="ai">AI快速出题</Radio.Button>
              <Radio.Button value="ai_import">🤖 AI工具录入</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {createSource === 'manual' && (
            <>
              <Radio.Group
                value={manualMode}
                onChange={(e) => {
                  const next = e.target.value;
                  // 切换录入方式时把已填内容带过去，避免老师填到一半一切换全丢
                  if (next === 'text') {
                    const rows = createForm.getFieldValue('manual_questions') || [];
                    const text = rows
                      .map((r: any) => String(r?.question_text || '').trim())
                      .filter(Boolean)
                      .join('\n');
                    if (text) createForm.setFieldValue('question_texts', text);
                  } else {
                    const rows = createForm.getFieldValue('manual_questions') || [];
                    const text = String(createForm.getFieldValue('question_texts') || '').trim();
                    if (text && rows.length === 0) {
                      createForm.setFieldValue('manual_questions', text
                        .split('\n')
                        .filter((line: string) => line.trim())
                        .map((line: string) => ({ question_text: line.trim(), answer_text: '', courseware_html: '' })));
                    }
                  }
                  setManualMode(next);
                }}
                size="small"
                style={{ marginBottom: 12 }}
              >
                <Radio.Button value="rows">逐题录入（可带 HTML 课件）</Radio.Button>
                <Radio.Button value="text">纯文本批量粘贴</Radio.Button>
              </Radio.Group>

              {manualMode === 'text' ? (
                <Form.Item
                  name="question_texts"
                  label="题目列表"
                  rules={[{ required: true, message: '请输入题目' }]}
                  extra="每行一道题目，题目将按顺序展示"
                >
                  <Input.TextArea
                    rows={8}
                    placeholder={`1. 计算 25 × 4 = ?\n2. 一个三角形有几个角？\n3. ...`}
                  />
                </Form.Item>
              ) : (
                <Form.List
                  name="manual_questions"
                  rules={[
                    {
                      validator: async (_: any, rows: any[]) => {
                        if (!rows || rows.length === 0) {
                          return Promise.reject(new Error('请至少添加一道题目'));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  {(fields, { add, remove }) => (
                    <>
                      {fields.length === 0 && (
                        <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>
                          还没有题目，点下方按钮一行一题地添加。
                        </div>
                      )}
                      {fields.map((field) => {
                        const hasCourseware = !!manualRows[field.name]?.courseware_html;
                        return (
                          <div
                            key={field.key}
                            style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 8 }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontWeight: 500 }}>第 {field.name + 1} 题</span>
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                            </div>
                            <Form.Item
                              {...field}
                              name={[field.name, 'question_text']}
                              rules={[{ required: true, message: '请输入题干' }]}
                              style={{ marginBottom: 8 }}
                            >
                              <Input.TextArea rows={2} placeholder="题干（课堂上投屏展示）" />
                            </Form.Item>
                            <Space wrap>
                              <Form.Item {...field} name={[field.name, 'answer_text']} style={{ marginBottom: 0 }}>
                                <Input style={{ width: 240 }} placeholder="参考答案（选填，仅教师可见）" />
                              </Form.Item>
                              <Form.Item {...field} name={[field.name, 'courseware_html']} hidden>
                                <Input.TextArea />
                              </Form.Item>
                              <Button
                                size="small"
                                icon={<CodeOutlined />}
                                type={hasCourseware ? 'primary' : 'default'}
                                onClick={() => openCoursewareEditor(field.name)}
                              >
                                {hasCourseware ? '课件已附（点击编辑）' : '添加 HTML 课件'}
                              </Button>
                              {hasCourseware && (
                                <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewHtml(manualRows[field.name]?.courseware_html || '')}>
                                  预览课件
                                </Button>
                              )}
                              <Upload
                                accept=".html,.htm,.txt"
                                showUploadList={false}
                                beforeUpload={(file) => handleUploadCourseware(file, field.name)}
                              >
                                <Button size="small" icon={<UploadOutlined />}>上传课件 HTML</Button>
                              </Upload>
                            </Space>
                          </div>
                        );
                      })}
                      <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ question_text: '', answer_text: '', courseware_html: '' })}>
                        添加一道题
                      </Button>
                      <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
                        课件不是必须的：附上 HTML 课件后，课堂上可以先展示课件让学生操作、思考，再回到题目作答。
                      </div>
                    </>
                  )}
                </Form.List>
              )}
            </>
          )}

          {createSource === 'bank' && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <Space style={{ marginBottom: 8 }} wrap>
                <Select
                  placeholder="按科目筛选"
                  style={{ width: 120 }}
                  allowClear
                  value={bankSubject}
                  onChange={(v) => setBankSubject(v)}
                >
                  {subjectOptions.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
                </Select>
                <Input
                  placeholder="搜索题干关键字"
                  style={{ width: 200 }}
                  value={bankKeyword}
                  onChange={(e) => setBankKeyword(e.target.value)}
                  onPressEnter={() => loadBank(1)}
                />
                <Button icon={<SearchOutlined />} onClick={() => loadBank(1)}>搜索</Button>
              </Space>
              <Table
                dataSource={bankQuestions}
                columns={bankColumns}
                rowKey="id"
                loading={bankLoading}
                size="small"
                pagination={{
                  current: bankPage,
                  pageSize: 10,
                  total: bankTotal,
                  onChange: (p) => loadBank(p),
                  showTotal: (t) => `共 ${t} 题`,
                }}
                rowSelection={{
                  selectedRowKeys: selectedBankIds,
                  onChange: (keys: React.Key[]) => setSelectedBankIds(keys as number[]),
                }}
                locale={{ emptyText: <Empty description="暂无题目，可先在发布作业中用AI生成" /> }}
              />
              <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                已选 {selectedBankIds.length} 道题（将导入题干与选项文本，作为课堂口答题使用）
              </div>
            </div>
          )}

          {createSource === 'ai' && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <Form.Item name="ai_mode" label="出题方式" initialValue="topic" style={{ marginBottom: 12 }}>
                <Radio.Group buttonStyle="solid" size="small">
                  <Radio.Button value="topic">按知识点</Radio.Button>
                  <Radio.Button value="requirements">按详细要求</Radio.Button>
                  <Radio.Button value="paste">粘贴题目</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {aiMode === 'topic' && (
                <>
                  <Form.Item name="ai_topic" label="知识点主题" rules={[{ required: true, message: '请输入知识点主题' }]} preserve={false}>
                    <Input placeholder="如：分数加减法、古诗背诵" />
                  </Form.Item>
                  {renderAiBatchEditor()}
                </>
              )}

              {aiMode === 'requirements' && (
                <>
                  <Form.Item
                    name="ai_requirements"
                    label="详细出题要求"
                    rules={[{ required: true, message: '请填写详细的出题要求' }]}
                    preserve={false}
                  >
                    <Input.TextArea rows={4} maxLength={2000} showCount placeholder={'用一段话描述你想出的课堂题目要求。例如：\n围绕本节课"光的折射"出抢答题，重点考查折射角与入射角的关系，题目要简短适合口头回答。'} />
                  </Form.Item>
                  {renderAiBatchEditor()}
                </>
              )}

              {aiMode === 'paste' && (
                <Form.Item
                  name="ai_raw_text"
                  label="粘贴题目原文"
                  rules={[{ required: true, message: '请粘贴题目内容' }]}
                  preserve={false}
                  extra="直接粘贴已有的题目（格式不必规范），AI会自动整理并补全参考答案，题目数量以粘贴内容为准"
                >
                  <Input.TextArea rows={8} maxLength={10000} showCount placeholder={'把已有的题目（可从Word/PDF/网页复制）粘贴到这里...'} />
                </Form.Item>
              )}

              {genLimit && (
                <Alert
                  style={{ marginBottom: 12 }}
                  type={genLimit.daily_remaining > 0 ? 'info' : 'warning'}
                  showIcon
                  message={genLimit.daily_remaining > 0
                    ? `今日剩余AI生成次数：${genLimit.daily_remaining} / ${genLimit.daily_limit}（与发布作业共用，次日0点重置）`
                    : `今日AI生成次数已用完（${genLimit.daily_limit}次），请明日0点后再试`}
                />
              )}
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={aiLoading}
                onClick={handleGenerateAI}
                disabled={genLimit ? genLimit.daily_remaining <= 0 : false}
                style={{ marginBottom: 12 }}
              >
                {aiLoading ? 'AI正在出题中...' : aiMode === 'paste' ? '🤖 AI整理题目' : '🤖 AI生成题目'}
              </Button>
              {/* 出题进度：让老师看得见在做什么，而不是一个停不下来的转圈 */}
              {aiLoading && aiProgress && (
                <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f6f8fa', borderRadius: 8 }}>
                  <Progress percent={aiProgress.percent} size="small" status="active" />
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {aiProgress.current}
                    {aiProgress.total > 1 && `（${aiProgress.done}/${aiProgress.total} 组题型已完成）`}
                    ，可以关掉弹窗，出题会在后台继续；随时点「查看出题进度」都能接回这个任务
                  </div>
                </div>
              )}
              {aiQuestions.length > 0 && (
                <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                  {aiQuestions.map((q, i) => (
                    <div key={i} style={{ padding: '6px 4px', borderBottom: '1px dashed #eee' }}>
                      <Checkbox
                        checked={aiSelected.has(i)}
                        onChange={(e) => {
                          const s = new Set(aiSelected);
                          if (e.target.checked) s.add(i); else s.delete(i);
                          setAiSelected(s);
                        }}
                      />
                      <span style={{ marginLeft: 8 }}>{i + 1}. {q.content}</span>
                      {q.type_label && <Tag color="blue" style={{ marginLeft: 8 }}>{q.type_label}</Tag>}
                      {q.answer && <Tag color="green" style={{ marginLeft: 8 }}>答案: {q.answer}</Tag>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                参考答案仅供老师核对，不会展示给学生。已勾选 {aiSelected.size} 道。
              </div>
            </div>
          )}

          {createSource === 'ai_import' && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 4px 12px 12px', marginBottom: 16 }}>
              {/* 两种录入方式左右分栏（tabPosition="left"）：每栏只讲一件事，互不干扰 */}
              <Tabs
                activeKey={aiImportTab}
                onChange={(k) => setAiImportTab(k as 'direct' | 'paste')}
                style={{ marginBottom: 0 }}
                items={[
    {
      key: 'direct',
      label: '方式一：AI 直接提交（推荐）',
      children: (
        <div style={{ border: '1px solid #bae0ff', background: '#f0f8ff', borderRadius: 8, padding: 12 }}>
          {!agentTokenPlain ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="还没有身份令牌"
                description="令牌相当于你的身份，AI 靠它写入题目。请先生成令牌，之后就能用一句话完成安装。"
              />
              <Button type="primary" icon={<KeyOutlined />} loading={agentCreating} onClick={handleCreateAgentToken}>
                {agentTokenList.length > 0 ? '重新生成令牌' : '生成令牌'}
              </Button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>方式 1：一句话安装（最省事）</div>
              <ol style={{ margin: '0 0 10px', paddingLeft: 20, fontSize: 13, color: '#333', lineHeight: 1.9 }}>
                <li>点下面「复制一句话指令」，粘给你的 AI 助手（WorkBuddy / CodeBuddy 等）。</li>
                <li>助手会自己去读这个地址、把能力装好，<b>不用你再下载或上传任何文件</b>。</li>
                <li>之后直接对它说「出 5 道题并带上课件」，题目会自动写入本页。</li>
              </ol>
              <Input.TextArea
                readOnly
                value={oneLineInstallPrompt}
                rows={3}
                style={{ fontFamily: 'Consolas, monospace', fontSize: 12, marginBottom: 8 }}
              />
              <Space wrap>
                <Button type="primary" icon={<CopyOutlined />} onClick={() => copyText(oneLineInstallPrompt, '指令已复制，粘贴给你的 AI 助手即可')}>
                  复制一句话指令
                </Button>
                <Button icon={<ApiOutlined />} loading={agentTesting} onClick={() => testAgentConnect()}>
                  测试连接
                </Button>
                <Button type="link" onClick={() => setShowMoreInstall((v) => !v)} style={{ fontSize: 12 }}>
                  {showMoreInstall ? '收起其它安装方式' : '其它安装方式'}
                </Button>
              </Space>

              {showMoreInstall && (
                <div style={{ marginTop: 12, borderTop: '1px dashed #bae0ff', paddingTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>方式 2：让助手用命令行安装到本地</div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
                    适用于能执行命令的助手，它会把文档写进自己的 skills 目录（WorkBuddy 为 <code>~/.workbuddy/skills/</code>）。
                    其他客户端的目录在文档里也列了。
                  </div>
                  <Input.TextArea
                    readOnly
                    value={cliInstallCommand}
                    rows={3}
                    style={{ fontFamily: 'Consolas, monospace', fontSize: 12, marginBottom: 8 }}
                  />
                  <Button icon={<CopyOutlined />} onClick={() => copyText(cliInstallCommand, '命令已复制，粘贴给助手执行即可')}>
                    复制安装命令
                  </Button>

                  <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>方式 3：下载 Skill 文件</div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                    手动把文件放进助手的 skills 目录。适合上面两种都不方便时使用。
                  </div>
                  <Space wrap>
                    <Button icon={<DownloadOutlined />} onClick={downloadAgentSkill}>下载 Skill 文件</Button>
                    <Button type="link" onClick={() => copyText(skillInstallUrl, '安装地址已复制')}>
                      复制安装地址
                    </Button>
                  </Space>
                </div>
              )}
            </>
          )}

          {/* 地址与令牌：Skill 文件与安装地址里都已经有了，只在需要手动配置时才展开 */}
          {agentTokenPlain && (
            <div style={{ marginTop: 10 }}>
              <a style={{ fontSize: 12 }} onClick={() => setShowAgentRaw((v) => !v)}>
                {showAgentRaw ? '收起地址与令牌' : '需要手动配置？查看地址与令牌'}
              </a>
              {showAgentRaw && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>接口地址</div>
                  <Space.Compact style={{ width: '100%', marginBottom: 10 }}>
                    <Input readOnly value={agentBaseUrl} style={{ fontFamily: 'Consolas, monospace' }} />
                    <Button icon={<CopyOutlined />} onClick={() => copyText(agentBaseUrl, '接口地址已复制')}>复制</Button>
                  </Space.Compact>

                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>身份令牌（等同你的身份，勿外传）</div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input readOnly value={agentTokenPlain} style={{ fontFamily: 'Consolas, monospace' }} />
                    <Button icon={<CopyOutlined />} onClick={() => copyText(agentTokenPlain, '令牌已复制')}>复制</Button>
                  </Space.Compact>
                </div>
              )}
            </div>
          )}

          {agentInfo && (
            <div style={{ marginTop: 10, background: '#fff', border: '1px solid #e6f4ff', borderRadius: 6, padding: 8, fontSize: 12 }}>
              <div>
                连接成功：当前身份 <b>{agentInfo.teacher?.real_name || agentInfo.teacher?.username}</b>
                （{agentInfo.teacher?.role === 'admin' ? '管理员' : '教师'}）
              </div>
              <div style={{ marginTop: 4 }}>
                任教班级：
                {(agentInfo.classes || []).length === 0 ? '未分配' : (agentInfo.classes || []).map((c: any) => (
                  <Tag key={c.id} color={c.role === 'head_teacher' ? 'gold' : 'blue'}>
                    {c.name}（{c.role === 'head_teacher' ? '班主任' : '任课教师'}{c.subject ? ` · ${c.subject}` : ''}）
                  </Tag>
                ))}
              </div>
              {agentInfo.gen_quota && (
                <div style={{ marginTop: 4, color: '#888' }}>
                  今日剩余 AI 生成次数：{agentInfo.gen_quota.daily_remaining} / {agentInfo.gen_quota.daily_limit}（AI 直连提交题目不消耗次数）
                </div>
              )}
            </div>
          )}

          {agentTokenList.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>我的令牌</div>
              {agentTokenList.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
                  <Tag color={t.revoked_at ? 'default' : 'green'}>{t.token_prefix}</Tag>
                  <span style={{ color: '#888' }}>{t.name}</span>
                  <span style={{ color: '#aaa' }}>
                    {t.last_used_at ? `最近使用 ${new Date(String(t.last_used_at).replace(' ', 'T')).toLocaleString('zh-CN')}` : '尚未使用'}
                  </span>
                  <Popconfirm title="吊销后 AI 立即无法访问，确定？" onConfirm={() => handleRevokeAgentToken(t.id)}>
                    <a style={{ color: '#ff4d4f' }}>吊销</a>
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'paste',
      label: '方式二：手动粘贴 AI 结果',
      children: (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="AI 不能联网时用这一种"
            description="把 Skill 文件或提示词交给 AI，让它按格式出题，再把结果粘贴到下面的框里。"
          />

          <Space wrap style={{ marginBottom: 12 }}>
            <Button icon={<DownloadOutlined />} onClick={downloadSkill}>下载 Skill 文件（粘贴用）</Button>
            <Button
              icon={<CopyOutlined />}
              onClick={() => copyText(
                AI_IMPORT_PROMPT + (aiRequirement.trim()
                  ? aiRequirement.trim()
                  : `${createForm.getFieldValue('subject') || '（科目）'}：${createForm.getFieldValue('title') || '（练习主题）'}，出 5 道课堂抢答题。`),
                '提示词已复制，发给 AI 即可'
              )}
            >
              复制 AI 提示词
            </Button>
          </Space>

          <Input.TextArea
            rows={2}
            value={aiRequirement}
            onChange={(e) => setAiRequirement(e.target.value)}
            placeholder="补充你的出题需求（会拼在提示词末尾）。例：五年级数学，分数的加减法，出 6 道抢答题。"
            style={{ marginBottom: 12 }}
          />

          <div style={{ marginBottom: 8, fontSize: 13 }}>粘贴 AI 返回的题目数据（JSON）</div>
          <Input.TextArea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'{\n  "title": "第三单元随堂练习",\n  "subject": "数学",\n  "questions": [\n    { "question_text": "题干", "answer_text": "参考答案", "courseware_html": "<!DOCTYPE html>...</html>" }\n  ]\n}'}
          />
          <Space wrap style={{ marginTop: 8 }}>
            <Upload accept=".json,.txt,.md,.html,.htm" showUploadList={false} beforeUpload={handleImportFile}>
              <Button icon={<UploadOutlined />}>上传 JSON / HTML 文件</Button>
            </Upload>
            <Button type="primary" icon={<RobotOutlined />} onClick={() => handleParseImport()}>
              解析预览
            </Button>
          </Space>

          {importedQuestions.length > 0 && (
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8, marginTop: 12 }}>
              {importedQuestions.map((q, i) => (
                <div key={i} style={{ padding: '6px 4px', borderBottom: '1px dashed #eee' }}>
                  <Checkbox
                    checked={importSelected.has(i)}
                    onChange={(e) => {
                      const s = new Set(importSelected);
                      if (e.target.checked) s.add(i); else s.delete(i);
                      setImportSelected(s);
                    }}
                  />
                  <span style={{ marginLeft: 8 }}>{i + 1}. {q.question_text}</span>
                  {q.answer_text && <Tag color="green" style={{ marginLeft: 8 }}>答案: {q.answer_text}</Tag>}
                  {q.courseware_html && (
                    <>
                      <Tag color="blue" style={{ marginLeft: 8 }}>课件</Tag>
                      <Button size="small" type="link" onClick={() => setPreviewHtml(q.courseware_html)}>预览</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
            课件不是必须的：没带 courseware_html 也能正常导入。已勾选 {importSelected.size} 道。
          </div>
        </div>
      )
    },
                ]}
              />
            </div>
          )}
        </Form>
      </Modal>

      {/* 详情 */}
      <Modal
        title={`课堂做题详情: ${quizDetail?.title || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={900}
      >
        <Spin spinning={detailLoading}>
        {quizDetail && (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="科目">{quizDetail.subject || '-'}</Descriptions.Item>
              <Descriptions.Item label="班级">{quizDetail.class_name}</Descriptions.Item>
              <Descriptions.Item label="状态">{renderStatus(quizDetail.status)}</Descriptions.Item>
              <Descriptions.Item label="创建者">{quizDetail.creator_name}</Descriptions.Item>
              <Descriptions.Item label="题目数">{questions.length}</Descriptions.Item>
              <Descriptions.Item label="奖励次数">{rewards.length}</Descriptions.Item>
            </Descriptions>
            {quizDetail.description && (
              <Paragraph type="secondary" style={{ marginBottom: 16 }}>{quizDetail.description}</Paragraph>
            )}

            {quizDetail.status === 'active' && questions.length > 0 && (
              <Space style={{ marginBottom: 16 }} wrap>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => handleOpenConsole(quizDetail)}>
                  进入课堂控制台
                </Button>
                <Button icon={<UserSwitchOutlined />} onClick={startRandomPick}>随机点名</Button>
              </Space>
            )}

            <Tabs
              items={[
                {
                  key: 'questions',
                  label: `题目列表 (${questions.length})`,
                  children: (
                    <List
                      dataSource={questions}
                      renderItem={(q: any, index: number) => (
                        <List.Item
                          actions={
                            quizDetail.status === 'active' ? [
                              <Button
                                key="reward"
                                type="link"
                                size="small"
                                icon={<GiftOutlined />}
                                onClick={() => {
                                  setDetailModalOpen(false);
                                  setTimeout(() => handleOpenReward(quizDetail, q.id), 100);
                                }}
                              >
                                奖励
                              </Button>
                            ] : undefined
                          }
                        >
                          <List.Item.Meta
                            avatar={<Tag color="blue">{index + 1}</Tag>}
                            title={<span style={{ whiteSpace: 'pre-wrap' }}>{q.question_text}</span>}
                            description={
                              <Space size={4} wrap style={{ marginTop: 4 }}>
                                {q.answer_text && <Tag color="green">参考答案：{q.answer_text}</Tag>}
                                {q.courseware_html && (
                                  <>
                                    <Tag color="cyan">含 HTML 课件</Tag>
                                    <Button size="small" type="link" onClick={() => setPreviewHtml(q.courseware_html)}>
                                      查看课件
                                    </Button>
                                  </>
                                )}
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                      locale={{ emptyText: <Empty description="暂无题目" /> }}
                    />
                  ),
                },
                {
                  key: 'rewards',
                  label: `奖励记录 (${rewards.length})`,
                  children: (
                    <>
                      <div style={{ marginBottom: 8, fontSize: 12, color: '#888' }}>
                        这里只显示本场的发放记录；要看全部课堂的，去列表页「发放记录」。
                      </div>
                      <Table
                        dataSource={rewards}
                        columns={rewardColumns}
                        rowKey="id"
                        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                        size="small"
                      />
                      {rewards.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Button
                            size="small"
                            icon={<HistoryOutlined />}
                            onClick={() => {
                              setRewardLogPreset({ quizId: quizDetail.id, classId: quizDetail.class_id });
                              setRewardLogOpen(true);
                            }}
                          >
                            在全部发放记录中查看
                          </Button>
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  key: 'answers',
                  label: `答题记录 (${answers.length})`,
                  children: (
                    <Table
                      dataSource={answers}
                      rowKey="id"
                      pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                      size="small"
                      columns={[
                        { title: '学生', dataIndex: 'student_name', width: 100 },
                        { title: '回答', dataIndex: 'answer_text', ellipsis: true },
                        { title: '判定', width: 70, render: (_: any, r: any) => r.is_correct ? <Tag color="green">正确</Tag> : <Tag color="red">错误</Tag> },
                        { title: '得分', width: 60, dataIndex: 'score', render: (v: number) => `${v ?? 0}分` },
                        { title: '金币', width: 60, dataIndex: 'coin_rewarded', render: (v: number) => v > 0 ? `+${v}` : '-' },
                        { title: '时间', dataIndex: 'created_at', width: 150, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
                      ]}
                      locale={{ emptyText: <Empty description="暂无课堂口答记录（在控制台用AI评判后自动保存）" /> }}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
        </Spin>
      </Modal>

      {/* 随机点名 */}
      <Modal
        title="随机点名"
        open={randomOpen}
        onCancel={() => setRandomOpen(false)}
        footer={
          pickedStudent ? (
            <Space>
              <Button onClick={startRandomPick}>再来一次</Button>
              <Button type="primary" icon={<GiftOutlined />} onClick={handleRewardPicked}>给TA发奖励</Button>
            </Space>
          ) : (
            <Button onClick={() => setRandomOpen(false)}>关闭</Button>
          )
        }
        width={480}
        centered
      >
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 40, fontWeight: 'bold', color: randomRolling ? '#999' : '#1890ff', minHeight: 60 }}>
            {randomName || '...'}
          </div>
          {pickedStudent && !randomRolling && (
            <div style={{ marginTop: 8 }}>
              {pickedStudent.pet_name && (
                <Text type="secondary">
                  宠物：{pickedStudent.pet_name} Lv.{pickedStudent.pet_level}（{pickedStudent.species_name}）
                </Text>
              )}
            </div>
          )}
          {randomRolling && <div style={{ marginTop: 12, color: '#999' }}>正在随机抽取中...</div>}
        </div>
      </Modal>

      {/* 课堂奖励发放记录（跨课堂聚合，可按班级/类型/关键字筛） */}
      <RewardLogDrawer
        open={rewardLogOpen}
        onClose={() => setRewardLogOpen(false)}
        presetQuizId={rewardLogPreset.quizId ?? null}
        presetClassId={rewardLogPreset.classId ?? null}
      />

      {/* 发放奖励 */}
      <Modal
        title="发放奖励"
        open={rewardModalOpen}
        onCancel={() => { setRewardModalOpen(false); setSelectedStudent(null); setSelectedQuestionId(null); }}
        onOk={() => rewardForm.submit()}
        confirmLoading={rewarding}
        width={700}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>选择学生：</Text>
          <div style={{
            marginTop: 8, maxHeight: 200, overflow: 'auto',
            border: '1px solid #f0f0f0', borderRadius: 8, padding: 8
          }}>
            <Row gutter={[8, 8]}>
              {students.map((s: any) => (
                <Col span={12} key={s.id}>
                  <Card
                    size="small"
                    hoverable
                    style={{
                      border: selectedStudent?.id === s.id ? '2px solid #1890ff' : '1px solid #f0f0f0',
                      borderRadius: 8, cursor: 'pointer'
                    }}
                    onClick={() => setSelectedStudent(s)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.pet_id ? (
                        <img
                          src={getPetThumbUrl(s)}
                          alt={s.pet_name}
                          style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain' }}
                        />
                      ) : (
                        <Avatar icon={<UserOutlined />} size={36} />
                      )}
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{s.real_name || s.username}</div>
                        {s.pet_name && (
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {s.pet_name} Lv.{s.pet_level} ({s.species_name})
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
              {students.length === 0 && <Empty description="暂无学生" style={{ width: '100%' }} />}
            </Row>
          </div>
        </div>

        {selectedStudent && (
          <div style={{
            padding: 12, background: '#e6f7ff', borderRadius: 8, marginBottom: 16
          }}>
            <Text>已选择: <Text strong>{selectedStudent.real_name || selectedStudent.username}</Text></Text>
            {selectedStudent.pet_name && (
              <Text style={{ marginLeft: 8 }}>宠物: <Text strong>{selectedStudent.pet_name}</Text></Text>
            )}
          </div>
        )}

        <Form form={rewardForm} layout="vertical" onFinish={handleReward}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="reward_type" label="奖励类型" rules={[{ required: true }]}>
                <Select
                  options={Object.entries(REWARD_TYPES).map(([k, v]) => ({ value: k, label: v.label }))}
                  placeholder="选择奖励类型"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              {(rewardType === 'item' || rewardType === 'equipment') ? (
                <Form.Item
                  name="reward_value"
                  label={rewardType === 'item' ? '选择物品' : '选择装备'}
                  rules={[{ required: true, message: rewardType === 'item' ? '请选择物品' : '请选择装备' }]}
                >
                  {rewardType === 'item' ? (
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={itemsLoading}
                      placeholder={itemsLoading ? '正在加载物品...' : items.length === 0 ? '暂无可发放的物品' : '选择要发放的物品'}
                      notFoundContent={itemsLoading ? '加载中...' : '没有可发放的物品'}
                      options={items.map((it: any) => ({
                        value: it.id,
                        label: `${it.name}（${it.price ?? '-'}金币）`,
                        name: it.name,
                      }))}
                      onSelect={(_, opt: any) => rewardForm.setFieldsValue({ reward_name: opt.name })}
                    />
                  ) : (
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={equipmentsLoading}
                      placeholder={equipmentsLoading ? '正在加载装备...' : equipments.length === 0 ? '暂无可发放的装备' : '选择要发放的装备'}
                      notFoundContent={equipmentsLoading ? '加载中...' : '没有可发放的装备'}
                      options={equipments.map((eq: any) => ({
                        value: eq.id,
                        label: `${eq.name}（${({ common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' } as Record<string, string>)[eq.rarity] || eq.rarity}）`,
                        name: eq.name,
                      }))}
                      onSelect={(_, opt: any) => rewardForm.setFieldsValue({ reward_name: opt.name })}
                    />
                  )}
                </Form.Item>
              ) : (
                <Form.Item name="reward_value" label="奖励数值" rules={[{ required: true, message: '请输入数量' }]}>
                  <InputNumber min={1} style={{ width: '100%' }} placeholder={rewardType === 'exp' ? '经验值' : '金币数量'} />
                </Form.Item>
              )}
            </Col>
          </Row>
          {/* 奖励名称与奖励原因并排：原来两个各占一整行，弹窗被撑得很高，
              金币类奖励只需填两项，竖着摆白白多占一半高度 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="reward_name" label="奖励名称（选物品/装备时自动填写）">
                <Input placeholder="如：100金币、体力药剂" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="reason" label="奖励原因（可选）">
                <Input placeholder="如：回答正确、表现优秀" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 课堂控制台 */}
      {consoleData && (
        <ClassroomConsole
          quiz={consoleData.quiz}
          questions={consoleData.questions}
          onClose={() => { setConsoleData(null); loadQuizzes(); }}
          onRewarded={loadQuizzes}
        />
      )}

      {/* 编辑题目的 HTML 课件 */}
      <Modal
        title={`HTML 课件${coursewareIndex !== null ? `（第 ${coursewareIndex + 1} 题）` : ''}`}
        open={coursewareIndex !== null}
        onCancel={() => setCoursewareIndex(null)}
        onOk={saveCourseware}
        width={860}
        okText="保存到题目"
        cancelText="取消"
      >
        <Space wrap style={{ marginBottom: 8 }}>
          <Button size="small" icon={<CodeOutlined />} onClick={() => setCoursewareDraft(COURSEWARE_TEMPLATE)}>
            插入模板
          </Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewHtml(coursewareDraft)} disabled={!coursewareDraft.trim()}>
            预览
          </Button>
          <Upload accept=".html,.htm,.txt" showUploadList={false} beforeUpload={async (file) => {
            setCoursewareDraft(await readFileAsText(file));
            return false;
          }}>
            <Button size="small" icon={<UploadOutlined />}>上传 HTML 文件</Button>
          </Upload>
        </Space>
        <Input.TextArea
          rows={14}
          value={coursewareDraft}
          onChange={(e) => setCoursewareDraft(e.target.value)}
          placeholder={'粘贴一个完整的 HTML 文档（以 <!DOCTYPE html> 开头），课堂上可投屏并让学生操作'}
        />
        <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
          课件要能离线打开：样式和脚本都写在这一个 HTML 里，不要引用外部网络资源。
        </div>
      </Modal>

      {/* 课件预览 */}
      <Modal
        title="课件预览"
        open={!!previewHtml}
        onCancel={() => setPreviewHtml('')}
        footer={null}
        width={900}
      >
        <iframe
          title="courseware-preview"
          srcDoc={previewHtml}
          style={{ width: '100%', height: '60vh', border: '1px solid #f0f0f0', borderRadius: 8, background: '#fff' }}
        />
      </Modal>
    </div>
  );
};

export default ClassroomQuiz;
