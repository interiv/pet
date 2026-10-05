import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table, Tag, Button, Modal, Form, Input, DatePicker, Select, InputNumber, message, Space, Radio, Checkbox, Progress, Card, Alert, Upload, Image, Divider, Empty, Statistic, Row, Col, Tabs, Badge, Popconfirm, Tooltip } from 'antd';
import { assignmentAPI, adminAPI, classroomQuizAPI } from '../utils/api';
import { pollAiTask } from '../utils/aiTask';
import { useAuthStore } from '../store/authStore';
import { buildPaperHtml, openPaperPrintWindow } from '../utils/printPaper';
import { getMySubject, SUBJECT_OPTIONS } from '../utils/subjects';
import { compressImageBlob, formatSize } from '../utils/imageCompress';
import dayjs from 'dayjs';
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, BookOutlined, EyeOutlined, BarChartOutlined, RobotOutlined, LoadingOutlined, CameraOutlined, StopOutlined, EditOutlined, PrinterOutlined, FileTextOutlined, PlusOutlined, DeleteOutlined, ClockCircleOutlined } from '@ant-design/icons';
import CelebrationAnimation from './CelebrationAnimation';
import PaperRegister from './PaperRegister';
import PaperBatchRegister from './PaperBatchRegister';

const { Option } = Select;
const { TextArea } = Input;

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface Question {
  id?: number;
  tempId?: number;
  variantIds?: number[];
  variants?: { tempId: number; content: string; options?: string[] | null; answer?: string; explanation?: string; type?: string; knowledge_point: string }[];
  content: string;
  options?: string[] | null;
  answer?: string;
  explanation?: string;
  analysis?: string;
  type: string;
  knowledge_point?: string;
  difficulty?: string;
  hasVariants?: boolean;
}

interface GeneratedResult {
  message: string;
  title: string;
  description: string;
  subject: string;
  question_type: string;
  question_types?: string[];
  spec_summary?: { question_type: string; type_label: string; difficulty: string; requested: number; generated: number }[];
  warning?: string;
  question_count: number;
  requested_count?: number;
  shortfall?: number;
  rejected_count?: number;
  usage_id?: number;
  total_generated: number;
  questions: Question[];
  allQuestionIds: number[];
}

/**
 * 放弃未发布的 AI 生成结果：向后端撤销一次生成，删除未被使用的题目并退还额度。
 * 已经发布出去的生成后端会拒绝撤销，这里静默忽略即可。
 */
const discardGeneration = async (usageId?: number, notify = false) => {
  if (!usageId) return false;
  try {
    await assignmentAPI.abandonGeneration(usageId);
    if (notify) message.info('已取消本次生成，未发布的内容不计入生成次数');
    return true;
  } catch {
    return false;
  }
};

const typeOptions = [
  { value: 'choice_single', label: '单选题' },
  { value: 'choice_multi', label: '多选题' },
  { value: 'judgment', label: '判断题' },
  { value: 'fill_blank', label: '填空题' },
  { value: 'essay', label: '简答题/作文' }
];

// 科目统一取共享列表（utils/subjects.ts）。原先这里只有 10 项，
// 若管理员给某教师设的是「音乐」等科目，下拉里会找不到、只能显示成一个孤立裸值
const subjectOptions = SUBJECT_OPTIONS;

const difficultyOptions = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' }
];

// 一次配置多种题型时，后端会把作业的 question_type 记成 mixed
const MIXED_TYPE = 'mixed';
const questionTypeLabel = (type: string) =>
  type === MIXED_TYPE ? '混合题型' : (typeOptions.find(t => t.value === type)?.label || type);

const defaultTypeSpec = () => ({ question_type: 'choice_single', count: 5, difficulty: 'medium' });

interface AssignmentsProps {
  onNavigate?: (menu: string) => void;
}

const Assignments: React.FC<AssignmentsProps> = ({ onNavigate }) => {
  const { user, checkAuth } = useAuthStore();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isDoModalVisible, setIsDoModalVisible] = useState(false);
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [isStatsModalVisible, setIsStatsModalVisible] = useState(false);
  
  const [currentAssignment, setCurrentAssignment] = useState<any>(null);
  const [generatedData, setGeneratedData] = useState<GeneratedResult | null>(null);
  const [submitResult, setSubmitResult] = useState<any>(null);
  /**
   * 本次提交是否在等AI 评阅。
   * 用它替代原先「message 里是否含『等待』」的字符串嗅探——
   * 那种写法一改文案就失效，而且会把 total_score 缺失的异常情况也当成正常。
   */
  const [submitResultAwaitingReview, setSubmitResultAwaitingReview] = useState(false);
  /** 点「刷新结果」时的 loading */
  const [checkingResult, setCheckingResult] = useState(false);
  const [statsData, setStatsData] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [assignmentTablePage, setAssignmentTablePage] = useState(1);
  const [assignmentTablePageSize, setAssignmentTablePageSize] = useState(10);
  const [createModalTab, setCreateModalTab] = useState('generate');
  const [showVariantQuestions, setShowVariantQuestions] = useState<Record<number, boolean>>({});
  const [filterSubject, setFilterSubject] = useState<string | undefined>(undefined);
  const [filterAssignmentType, setFilterAssignmentType] = useState<string | undefined>(undefined);
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [paperRegister, setPaperRegister] = useState<{ id: number; title: string } | null>(null);
  const [paperBatchRegister, setPaperBatchRegister] = useState<{ id: number; title: string } | null>(null);

  // 打印纸质作业纸相关
  const [printTarget, setPrintTarget] = useState<{ id: number; title: string } | null>(null);
  const [printAssignment, setPrintAssignment] = useState<any>(null);
  const [printQuestions, setPrintQuestions] = useState<any[]>([]);
  const [printClassStudents, setPrintClassStudents] = useState<any[]>([]);
  const [printStudentIds, setPrintStudentIds] = useState<number[]>([]);
  const [printSubmittedIds, setPrintSubmittedIds] = useState<number[]>([]);
  const [printMode, setPrintMode] = useState<'blank' | 'named'>('named');
  const [printShowAnswer, setPrintShowAnswer] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);

  // ===== 逐题作答计时 =====
  // 记录每题「首次进入视野」的时刻，提交时算出耗时。
  // 用途：识别长时间无响应只蒙答案的情况（全库此前没有任何答题耗时数据）。
  const qStartRef = useRef<Record<number, number>>({});
  const questionViewRef = useRef<number | null>(null);

  const markQuestionViewed = (qid: number) => {
    if (questionViewRef.current === qid) return;
    questionViewRef.current = qid;
    if (!qStartRef.current[qid]) qStartRef.current[qid] = Date.now();
  };

  const getQuestionDuration = (qid: number): number | undefined => {
    const start = qStartRef.current[qid];
    if (!start) return undefined;
    return Date.now() - start;
  };

  const resetQuestionTimers = () => {
    qStartRef.current = {};
    questionViewRef.current = null;
  };
  
  const [form] = Form.useForm();
  const [generateForm] = Form.useForm();
  // 「发布设置」表单只在切到第3步时才挂载，生成后的默认值先存 ref，等表单挂载再写入。
  // 直接调用 form.setFieldsValue() 会因表单未连接而触发 antd 告警。
  const pendingPublishDefaults = useRef<any>(null);
  // 题目编辑弹窗的初始值（弹窗挂载后再写入，避免 antd 告警）
  const pendingEditValues = useRef<any>(null);
  
  const [generating, setGenerating] = useState(false);
  // 出题任务进度（后端异步执行，这里轮询拿）
  const [genProgress, setGenProgress] = useState<{ percent: number; done: number; total: number; current: string } | null>(null);
  const [genMode, setGenMode] = useState<'topic' | 'requirements' | 'paste'>('topic');
  const [genLimit, setGenLimit] = useState<{ daily_limit: number; daily_used: number; daily_remaining: number; global_tokens_remaining: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, any>>({});
  const [uploadedImages, setUploadedImages] = useState<Record<number, string>>({});
  /** 正在压缩+上传的题号，用于在对应位置显示进度（多题同时传也不串） */
  const [uploadingImageFor, setUploadingImageFor] = useState<number | null>(null);
  const [progressMilestones, setProgressMilestones] = useState<Set<number>>(new Set());
  const [shuffledOptionMap, setShuffledOptionMap] = useState<Record<number, number[]>>({});
  const [shuffledQuestionOrder, setShuffledQuestionOrder] = useState<number[]>([]);

  // 实时答题进度激励：跨越 25% / 50% / 75% / 100% 时提示
  useEffect(() => {
    if (!currentAssignment || !isDoModalVisible || isTeacher) return;
    const qs = currentAssignment.questions || [];
    if (qs.length === 0) return;
    const done = qs.filter((q: Question) => {
      const a = studentAnswers[q.id!];
      return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && a.length === 0);
    }).length;
    const percent = Math.round((done / qs.length) * 100);
    const milestones = [25, 50, 75, 100];
    const emojiMap: Record<number, string> = {
      25: '👍 已完成 25%，保持节奏！',
      50: '⚡ 已完成一半，继续加油！',
      75: '🔥 75% 到手，胜利在望！',
      100: '🎉 全部完成，记得检查后提交！'
    };
    for (const m of milestones) {
      if (percent >= m && !progressMilestones.has(m)) {
        message.success(emojiMap[m]);
        setProgressMilestones(prev => new Set(prev).add(m));
      }
    }
  }, [studentAnswers, currentAssignment, isDoModalVisible]);
  
  // 题目编辑状态
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number>(-1);
  const [editingVariantParentIndex, setEditingVariantParentIndex] = useState<number>(-1);
  const [editingVariantIndex, setEditingVariantIndex] = useState<number>(-1);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  
  // 庆祝动画状态
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState({
    expReward: 0,
    goldReward: 0,
    leveledUp: false,
    newLevel: 0,
    evolved: false,
    newStage: ''
  });

  const isMobile = useMobile();

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  // 教师自己的任教科目：留作业时默认带出，老师仍可手动改成其他科目
  const mySubject = useMemo(() => {
    const teacherClasses = user?.teacher_classes;
    const classId = selectedClass ?? (classes.length === 1 ? classes[0].id : undefined);
    return getMySubject(teacherClasses, classId);
  }, [user, selectedClass, classes]);

  // 统计卡片的时间维度卡片（今日 / 近7 天 / 近 30 天）
  const [statRanges, setStatRanges] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadAssignments();
      if (isTeacher) {
        loadClasses();
        loadGenLimit();
      }
      loadAISettings();
    }
  }, [user]);

  useEffect(() => {
    if (user) loadAssignments();
  }, [selectedClass, filterSubject, filterDateRange, filterAssignmentType]);

  // 切到「3. 发布设置」时表单才挂载，此时再把生成时算好的默认值写进去
  useEffect(() => {
    if (createModalTab === 'publish' && generatedData && pendingPublishDefaults.current) {
      form.setFieldsValue(pendingPublishDefaults.current);
      pendingPublishDefaults.current = null;
    }
  }, [createModalTab, generatedData, form]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (e) {
      console.error('加载班级列表失败');
    }
  };

  // 旧的「读 AI 设置来取客户端超时」逻辑已随异步任务改造移除：
  // 出题不再依赖长连接，客户端超时统一按提交任务的短请求处理。
  const loadAISettings = async () => {};

  const loadGenLimit = async () => {
    try {
      const res = await adminAPI.getMyGenLimit();
      setGenLimit(res.data);
    } catch (e) {
      // 非教师角色可能无权限，静默
    }
  };

  const loadAssignments = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const params: any = {};
      if (selectedClass) params.class_id = selectedClass;
      if (filterSubject) params.subject = filterSubject;
      if (filterAssignmentType) params.assignment_type = filterAssignmentType;
      if (filterDateRange && filterDateRange[0]) params.date_from = filterDateRange[0].format('YYYY-MM-DD');
      if (filterDateRange && filterDateRange[1]) params.date_to = filterDateRange[1].format('YYYY-MM-DD');
      const res = await assignmentAPI.getAssignments(params);
      setAssignments(res.data.assignments || []);

      // 教师端额外拉取「预习/作业/复习」分组学情
      if (user.role === 'teacher' || user.role === 'admin') {
        try {
          const sum = await assignmentAPI.getAssignmentTypeSummary({
            class_id: selectedClass ?? undefined,
            subject: filterSubject,
            date_from: filterDateRange?.[0]?.format('YYYY-MM-DD'),
            date_to: filterDateRange?.[1]?.format('YYYY-MM-DD'),
          });
          setStatRanges(sum.data.ranges || []);
        } catch (e) {
          // 统计失败不影响列表
        }
      }
    } catch (e) {
      console.error('加载作业失败:', e);
      message.error('加载作业失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 轮询出题任务进度，直到拿到结果或失败。
   *
   * 复用 utils/aiTask 的统一实现（全站所有 AI 长任务共用同一套轮询逻辑），
   * 后端把耗时几百秒的出题放到后台执行，这里每 2 秒问一次「做到哪了」，
   * 每次请求都在 1 秒内结束，因此不受 Nginx proxy_read_timeout 影响。
   */
  const pollGenerateTask = (taskId: string) =>
    pollAiTask(taskId, '/assignments/generate/:taskId', setGenProgress);

  const handleGenerateQuestions = async (values: any) => {
    // 粘贴模式不校验题型：题型由 AI 逐题自动判断，也不需要出题规格
    const isPaste = genMode === 'paste';

    setGenerating(true);
    try {
      // 上一次生成还没发布就又点「生成」：先撤销上一次，别让它白占次数
      if (await discardGeneration(generatedData?.usage_id)) {
        loadGenLimit();
      }

      const payload: any = {
        subject: values.subject,
        grade_level: values.grade_level || '',
        mode: genMode
      };
      // 出题规格，粘贴模式不用它、保持为空
      let specs: { question_type: string; count: number; difficulty: string }[] = [];

      if (isPaste) {
        // 不传 question_type：后端会走「AI 自动判型」模板
        payload.raw_text = values.raw_text;
      } else {
        // 按知识点 / 按详细要求出题：可以一次配置多种题型，各自指定数量与难度
        const rawSpecs: any[] = Array.isArray(values.type_specs) ? values.type_specs : [];
        specs = rawSpecs
          .filter((r: any) => r && r.question_type)
          .map((r: any) => ({
            question_type: r.question_type,
            count: Math.max(1, parseInt(r.count, 10) || 5),
            difficulty: r.difficulty || 'medium'
          }));
        if (specs.length === 0) {
          message.error('请至少添加一种题型');
          return;
        }
        if (new Set(specs.map((s: any) => s.question_type)).size !== specs.length) {
          message.error('同一种题型只能添加一行，请直接调整那一行的数量');
          return;
        }
        payload.type_specs = specs;
        if (genMode === 'topic') {
          payload.topic = values.topic;
        } else {
          payload.requirements = values.requirements;
        }
      }
      // 出题在后台跑（实测多题型要 250 秒以上，长连接会被 Nginx 60s 切断）。
      // 这里改成「提交任务 + 轮询进度」：每次请求都在 1 秒内返回，永不超时。
      setGenProgress({ percent: 0, done: 0, total: specs.length || 1, current: '正在提交任务' });
      const submitRes = await assignmentAPI.generateQuestions(payload, 30);
      const taskId: string | undefined = submitRes.data?.task_id;
      if (!taskId) {
        throw new Error('后端未返回任务号，请确认服务端已更新到最新版本');
      }
      const polled = await pollGenerateTask(taskId);
      setGenProgress(null);
      const res: { data: GeneratedResult } = { data: polled };
      setGeneratedData(res.data);
      const nextDayMidnight = dayjs().add(1, 'day').startOf('day');
      const allClassIds = classes.map(c => c.id);
      pendingPublishDefaults.current = {
        title: res.data.title,
        description: res.data.description,
        question_type: res.data.question_type,
        subject: res.data.subject,
        class_ids: allClassIds,
        due_date: nextDayMidnight
      };
      setShowVariantQuestions({});
      setCreateModalTab('preview');
      if (res.data.warning) {
        message.warning(res.data.warning);
      }
      if ((res.data.shortfall || 0) > 0) {
        message.warning(`AI 本次只生成了 ${res.data.question_count} 道（目标 ${res.data.requested_count} 道），可再次点击生成补齐剩余题目`);
      } else {
        const qTypes = res.data.question_types || [];
        const typeSummary = qTypes.length > 1 ? `${qTypes.length} 种题型` : '';
        message.success(`成功生成 ${res.data.question_count} 道题目${typeSummary ? `（${typeSummary}）` : ''}，共${res.data.total_generated}道含变体`);
      }
      loadGenLimit();
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 409) {
        // 后端拦截了重复点击：同一教师同时只允许一个生成任务
        message.warning(e.response?.data?.error || '已有一个生成任务正在进行，请等待它完成');
      } else if (e.code === 'ECONNABORTED') {
        message.error('提交任务超时，请检查网络后重试');
      } else if (e.isAxiosError) {
        const errMsg = e.response?.data?.error
          || (status === 429 ? '今日生成次数已达上限' : 'AI生成失败');
        message.error(errMsg);
        if (status === 429) {
          loadGenLimit();
        }
      } else {
        // 轮询阶段抛出的普通 Error：额度已由后端退还，直接展示原因
        message.error(e.message || 'AI生成失败');
      }
    } finally {
      setGenProgress(null);
      setGenerating(false);
    }
  };

  const handleCreateAssignment = async (values: any) => {
    try {
      const classIds: number[] = values.class_ids || [];
      if (classIds.length === 0) {
        message.error('请选择至少一个班级');
        return;
      }
      const questionIds = (generatedData?.questions || []).map(q => {
        if (q.hasVariants && q.variantIds && q.variantIds.length > 0) {
          return q.variantIds[0];
        }
        return q.tempId || q.id;
      }).filter(Boolean) as number[];
      const basePayload = {
        title: values.title,
        description: values.description,
        subject: values.subject,
        question_type: values.question_type,
        max_exp: values.max_exp,
        due_date: values.due_date.toISOString(),
        question_ids: questionIds,
        assignment_type: values.assignment_type || 'homework',
        ai_config: { auto_grade: true, question_type: values.question_type }
      };
      let successCount = 0;
      let failCount = 0;
      for (const cid of classIds) {
        try {
          await assignmentAPI.createAssignment({ ...basePayload, class_id: cid });
          successCount++;
        } catch {
          failCount++;
        }
      }
      if (successCount > 0) {
        message.success(`作业发布成功！已发布到 ${successCount} 个班级${failCount > 0 ? `，${failCount} 个班级发布失败` : ''}`);
      } else {
        message.error('作业发布失败');
        return;
      }
      setIsCreateModalVisible(false);
      pendingPublishDefaults.current = null;
      setGeneratedData(null);
      loadAssignments();
    } catch (e: any) {
      message.error(e.response?.data?.error || '发布失败');
    }
  };


  // 打开打印设置弹窗（住校生无设备场景：打印纸质卷 → 学生笔答 → 拍照上传 AI 判分）
  const openPrintDialog = async (record: any) => {
    setPrintTarget({ id: record.id, title: record.title });
    setPrintMode('named');
    setPrintShowAnswer(false);
    setPrintStudentIds([]);
    setPrintLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        assignmentAPI.getAssignment(record.id),
        record.class_id ? classroomQuizAPI.getClassStudents(record.class_id).catch(() => null) : Promise.resolve(null),
      ]);
      const a = aRes.data.assignment;
      const qs: any[] = a.questions || [];
      const list: any[] = sRes?.data?.students || [];
      setPrintAssignment(a);
      setPrintQuestions(qs);
      setPrintClassStudents(list);
      setPrintStudentIds(list.map((s: any) => s.id));
      // 已交作业的学生不必再发纸质卷
      try {
        const st = await assignmentAPI.getStatistics(record.id);
        const done = new Set<number>((st.data?.student_results || []).map((r: any) => r.user_id));
        setPrintSubmittedIds([...done]);
      } catch (e) {
        setPrintSubmittedIds([]);
      }
    } catch (e) {
      message.error('获取作业内容失败');
      setPrintTarget(null);
    } finally {
      setPrintLoading(false);
    }
  };

  // 生成打印页：named 模式按勾选名单逐人出页，页眉预填姓名
  const handlePrintPaper = () => {
    if (!printAssignment) return;
    const named = printMode === 'named'
      ? printClassStudents.filter(s => printStudentIds.includes(s.id))
      : [];
    if (printMode === 'named' && named.length === 0) {
      message.warning('请至少选择一名学生');
      return;
    }
    const html = buildPaperHtml({
      assignment: printAssignment,
      questions: printQuestions,
      namedStudents: named.map(s => ({ id: s.id, real_name: s.real_name, username: s.username })),
      showAnswer: printShowAnswer,
    });
    const ok = openPaperPrintWindow(html, true);
    if (!ok) {
      message.warning('浏览器拦截了弹出窗口，请允许弹窗后重试');
      return;
    }
    message.success(named.length > 0 ? `已生成 ${named.length} 份带姓名的作业纸，请在打印窗口确认` : '已生成空白作业纸，请在打印窗口确认');
  };

  const handleStartDoing = async (record: any) => {
    try {
      const res = await assignmentAPI.getAssignment(record.id);
      const assignment = res.data.assignment;
      
      if (!isTeacher && assignment.questions) {
        const questions = assignment.questions;
        const qOrder = questions.map((_: any, i: number) => i);
        for (let i = qOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [qOrder[i], qOrder[j]] = [qOrder[j], qOrder[i]];
        }
        setShuffledQuestionOrder(qOrder);

        const optMap: Record<number, number[]> = {};
        for (const q of questions) {
          if (q.options && q.options.length > 0) {
            const indices = q.options.map((_: any, i: number) => i);
            for (let i = indices.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            optMap[q.id] = indices;
          }
        }
        setShuffledOptionMap(optMap);
      } else {
        setShuffledQuestionOrder([]);
        setShuffledOptionMap({});
      }

      setCurrentAssignment(assignment);
      if (isTeacher && assignment.questions) {
        const prefill: Record<number, any> = {};
        for (const q of assignment.questions) {
          if (q.answer) {
            if (q.type === 'choice_multi') {
              prefill[q.id] = q.answer.split(',').map((a: string) => a.trim());
            } else {
              prefill[q.id] = q.answer;
            }
          }
        }
        setStudentAnswers(prefill);
      } else {
        setStudentAnswers({});
      }
      setUploadedImages({});
      setProgressMilestones(new Set());
      resetQuestionTimers();
      setIsDoModalVisible(true);
    } catch (e: any) {
      message.error(e.response?.data?.error || '获取作业详情失败');
    }
  };

  const handleSubmitAnswers = async () => {
    const questions = currentAssignment?.questions || [];
    if (questions.length === 0) return;

    if (isTeacher) {
      setSubmitting(true);
      try {
        for (const q of questions) {
          const ans = studentAnswers[q.id];
          if (ans === undefined || ans === null) continue;
          const updatePayload: any = {};
          if (Array.isArray(ans)) {
            updatePayload.answer = ans.join(',');
          } else {
            updatePayload.answer = String(ans);
          }
          await assignmentAPI.updateQuestion(q.id, updatePayload);
        }
        message.success('答案/评阅标准已更新');
        setIsDoModalVisible(false);
      } catch (e: any) {
        message.error(e.response?.data?.error || '更新失败');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    let allAnswered = true;
    const answers: any[] = [];

    for (const q of questions) {
      const ans = studentAnswers[q.id];
      if (ans === undefined || ans === null || (Array.isArray(ans) && ans.length === 0) || (typeof ans === 'string' && ans.trim() === '')) {
        allAnswered = false;
      }
      answers.push({
        question_id: q.id,
        answer: ans,
        image_url: uploadedImages[q.id] || '',
        // 逐题作答耗时（毫秒）。后端只接受 0.5s~30min 的合理区间，异常值会被忽略。
        duration_ms: getQuestionDuration(q.id),
      });
    }

    if (!allAnswered) {
      message.warning('请完成所有题目后再提交');
      return;
    }

    setSubmitting(true);
    try {
      const res = await assignmentAPI.submitAssignment(currentAssignment.id, { answers });
      setSubmitResult(res.data);
      setIsDoModalVisible(false);
      setIsResultModalVisible(true);
      loadAssignments();

      // 用后端给的明确标记判断，不再靠 message 文本里有没有「等待」两个字——
      // 那种嗅探方式一改文案就失效。这里判断「总分是否已就绪」。
      const gradedNow = typeof res.data.total_score === 'number' && res.data.total_score > 0;
      setSubmitResultAwaitingReview(!gradedNow);
      if (res.data.success && gradedNow) {
        message.success(`提交成功！得分：${res.data.total_score}分，获得 ${res.data.gold_reward} 金币`);
        checkAuth();

        setCelebrationData({
          expReward: res.data.exp_reward || 0,
          goldReward: res.data.gold_reward || 0,
          leveledUp: res.data.levelUp?.leveledUp || false,
          newLevel: res.data.levelUp?.newLevel || 0,
          evolved: !!res.data.levelUp?.newStage,
          newStage: res.data.levelUp?.newStage || ''
        });
        setShowCelebration(true);
        setTimeout(() => { setShowCelebration(false); }, 5000);
      } else {
        // 主观题：已提交，AI 在后台评阅。让学生该干嘛干嘛，别守着等。
        message.info('已提交！主观题正在由 AI 评阅，完成后可在作业列表看到分数');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 打开某份提交的结果。
   *
   * 主观题是异步评阅的，学生点开时可能还没判完。
   * 这里不自动轮询——学生可能开着页面不管，轮询既费流量又没意义；
   * 改成给一个「刷新结果」按钮，想看的时候点一下。
   */
  const handleViewResult = async (record: any) => {
    try {
      const res = await assignmentAPI.getSubmissionDetail(record.my_submission_id);
      const sub = res.data.submission || {};
      const answers = res.data.answers || [];
      const awaiting = sub.review_status === 'pending' || sub.review_status === 'reviewing';
      setSubmitResult({
        results: answers,
        total_score: sub.total_score,
        total_max_score: sub.total_max_score,
        gold_reward: sub.gold_reward,
        correct_count: answers.filter((a: any) => a.is_correct).length,
        total_count: answers.length,
      });
      setSubmitResultAwaitingReview(awaiting);
      setIsResultModalVisible(true);
    } catch (e) {
      message.error('获取结果失败');
    }
  };

  /** 结果弹窗里点「刷新结果」：重新拉一次，判完了就更新分数 */
  const handleRefreshResult = async () => {
    const record = assignments.find((a: any) => a.my_submission_id === submitResult?.submission_id)
      || assignments.find((a: any) => a.my_submission_id);
    const sid = record?.my_submission_id || submitResult?.submission_id;
    if (!sid) { message.info('请先提交作业'); return; }
    setCheckingResult(true);
    try {
      const res = await assignmentAPI.getSubmissionDetail(sid);
      const sub = res.data.submission || {};
      const answers = res.data.answers || [];
      const awaiting = sub.review_status === 'pending' || sub.review_status === 'reviewing';
      setSubmitResult((prev: any) => ({
        ...(prev || {}),
        results: answers,
        total_score: sub.total_score,
        total_max_score: sub.total_max_score,
        gold_reward: sub.gold_reward,
        correct_count: answers.filter((a: any) => a.is_correct).length,
        total_count: answers.length,
        submission_id: sub.id,
      }));
      setSubmitResultAwaitingReview(awaiting);
      loadAssignments();
      if (!awaiting) message.success(`评阅完成，得分 ${sub.total_score}分`);
      else message.info('还在评阅中，请稍候再试');
    } catch (e) {
      message.error('刷新失败');
    } finally {
      setCheckingResult(false);
    }
  };

  /**
   * 上传某道题的手写作答照片。
   *
   * 先在客户端压缩再传：手机拍一张 3~5MB，直接传既慢又占服务器带宽，
   * 而这已经是项目里现成的做法（纸质扫描那条路在用同一套）。
   */
  const handleUploadImage = async (questionId: number, file: File) => {
    const questionNo = (currentAssignment?.questions || []).findIndex((x: any) => x.id === questionId) + 1;
    setUploadingImageFor(questionId);
    try {
      const blob = await compressImageBlob(file);
      const res = await assignmentAPI.uploadImage(blob);
      setUploadedImages(prev => ({ ...prev, [questionId]: res.data.url }));
      const saved = file.size > 0 ? file.size - blob.size : 0;
      message.success(
        `第 ${questionNo} 题作答照片已上传` +
        (saved > 100 * 1024 ? `（已压缩 ${formatSize(file.size)} → ${formatSize(blob.size)}）` : '')
      );
    } catch (e: any) {
      message.error(e.response?.data?.error || e?.message || '上传失败');
    } finally {
      setUploadingImageFor(null);
    }
  };
  
  // 打开题目编辑
  // 编辑表单在弹窗挂载后才存在，这里只暂存初始值，等 afterOpenChange 时再写入，
  // 避免 antd 的「useForm 未连接」告警。
  const handleEditQuestion = (question: Question, index: number, variantParentIndex?: number, variantIndex?: number) => {
    setEditingQuestion(question);
    setEditingQuestionIndex(index);
    setEditingVariantParentIndex(variantParentIndex ?? -1);
    setEditingVariantIndex(variantIndex ?? -1);
    let answerValue: any = question.answer || '';
    if (question.type === 'choice_multi' && typeof answerValue === 'string') {
      answerValue = answerValue.split(',').map(a => a.trim()).filter(Boolean);
    }
    pendingEditValues.current = {
      content: question.content,
      options: question.options ? question.options.join('\n') : '',
      difficulty: 'medium',
      knowledge_point: question.knowledge_point || '',
      answer: answerValue,
      explanation: question.explanation || '',
      analysis: ''
    };
    setEditModalVisible(true);
  };
  
  // 保存题目编辑
  const handleSaveEdit = async (values: any) => {
    if (!editingQuestion) return;
    
    const newOptions = values.options ? values.options.split('\n').filter((opt: string) => opt.trim()) : null;
    const isObjective = ['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(editingQuestion.type);
    const updatedQuestion: Question = {
      ...editingQuestion,
      content: values.content,
      options: newOptions,
      knowledge_point: values.knowledge_point || editingQuestion.knowledge_point,
      answer: isObjective ? values.answer : values.answer || editingQuestion.answer,
      explanation: values.explanation || editingQuestion.explanation,
    };
    
    try {
      let targetIds: number[] = [];
      if (editingQuestion.variantIds && editingQuestion.variantIds.length > 0) {
        targetIds = editingQuestion.variantIds;
      } else if (editingQuestion.id) {
        targetIds = [editingQuestion.id];
      } else if (editingQuestion.tempId) {
        targetIds = [editingQuestion.tempId];
      }
      const updatePayload: any = {
        content: values.content,
        options: newOptions,
        knowledge_point: values.knowledge_point,
        difficulty: values.difficulty,
        explanation: values.explanation,
        sync_group: editingVariantParentIndex < 0,
      };
      if (values.answer) {
        if (Array.isArray(values.answer)) {
          updatePayload.answer = values.answer.join(',');
        } else {
          updatePayload.answer = String(values.answer);
        }
      }
      if (values.analysis) {
        updatePayload.analysis = values.analysis;
      }
      for (const qid of targetIds) {
        await assignmentAPI.updateQuestion(qid, updatePayload);
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '保存到题库失败');
      return;
    }

    if (generatedData) {
      const newQuestions = [...generatedData.questions];
      if (editingVariantParentIndex >= 0 && editingVariantIndex >= 0) {
        const parentQ = { ...newQuestions[editingVariantParentIndex] };
        const newVariants = [...(parentQ.variants || [])];
        newVariants[editingVariantIndex] = updatedQuestion as typeof newVariants[number];
        parentQ.variants = newVariants;
        newQuestions[editingVariantParentIndex] = parentQ;
      } else if (editingQuestionIndex >= 0) {
        newQuestions[editingQuestionIndex] = updatedQuestion;
      }
      setGeneratedData({ ...generatedData, questions: newQuestions });
    } else if (currentAssignment && editingQuestion.id) {
      const newQuestions = [...(currentAssignment.questions || [])];
      for (let qi = 0; qi < newQuestions.length; qi++) {
        if (newQuestions[qi].id === editingQuestion.id) {
          newQuestions[qi] = { ...newQuestions[qi], ...updatedQuestion };
          if (updatedQuestion.answer !== undefined) {
            setStudentAnswers(prev => ({ ...prev, [editingQuestion.id!]: updatedQuestion.answer }));
          }
          break;
        }
        const variants = (newQuestions[qi] as any).variants;
        if (variants) {
          for (let vi = 0; vi < variants.length; vi++) {
            if (variants[vi].id === editingQuestion.id) {
              variants[vi] = { ...variants[vi], ...updatedQuestion };
              break;
            }
          }
        }
      }
      setCurrentAssignment({ ...currentAssignment, questions: newQuestions });
    }
    message.success('题目已更新');
    
    setEditModalVisible(false);
    setEditingQuestion(null);
    setEditingQuestionIndex(-1);
    setEditingVariantParentIndex(-1);
    setEditingVariantIndex(-1);
  };
  
  // 删除题目
  const handleDeleteQuestion = (index: number) => {
    if (!generatedData) return;
    
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这道题目吗?',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        const newQuestions = generatedData.questions.filter((_, i) => i !== index);
        const newAllQuestionIds = generatedData.allQuestionIds.filter((_, i) => i !== index);
        setGeneratedData({
          ...generatedData,
          questions: newQuestions,
          allQuestionIds: newAllQuestionIds,
          question_count: newQuestions.length
        });
        message.success('题目已删除');
      }
    });
  };

  const handleRetryWrong = () => {
    if (!submitResult?.wrong_questions || submitResult.wrong_questions.length === 0) return;
    
    const wrongQs = submitResult.wrong_questions;
    const retryQuestions = wrongQs.map((wq: any, idx: number) => ({
      ...wq.retry_question,
      id: wq.retry_question?.id ?? wq.retry_question?.question_id ?? `retry_${idx}`,
      originalId: wq.original_question_id
    }));
    
    const qOrder = retryQuestions.map((_: any, i: number) => i);
    for (let i = qOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qOrder[i], qOrder[j]] = [qOrder[j], qOrder[i]];
    }
    setShuffledQuestionOrder(qOrder);

    const optMap: Record<number, number[]> = {};
    for (const q of retryQuestions) {
      if (q.options && q.options.length > 0) {
        const indices = q.options.map((_: any, i: number) => i);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        optMap[q.id] = indices;
      }
    }
    setShuffledOptionMap(optMap);

    setCurrentAssignment((prev: any) => ({
      ...prev,
      questions: retryQuestions,
      isRetryMode: true
    }));
    setStudentAnswers({});
    setUploadedImages({});
    setIsResultModalVisible(false);
    resetQuestionTimers();
    setIsDoModalVisible(true);
    setSubmitResult(null);
    message.info(`请重新作答 ${retryQuestions.length} 道错题`);
  };

  const handleRetryWrongFromList = async (record: any) => {
    try {
      const res = await assignmentAPI.getRetryQuestions(record.id);
      const retryQuestions = res.data.retry_questions || [];
      if (retryQuestions.length === 0) {
        message.info('没有需要重做的错题');
        return;
      }

      const qOrder = retryQuestions.map((_: any, i: number) => i);
      for (let i = qOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qOrder[i], qOrder[j]] = [qOrder[j], qOrder[i]];
      }
      setShuffledQuestionOrder(qOrder);

      const optMap: Record<number, number[]> = {};
      for (const q of retryQuestions) {
        if (q.options && q.options.length > 0) {
          const indices = q.options.map((_: any, i: number) => i);
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
          }
          optMap[q.id] = indices;
        }
      }
      setShuffledOptionMap(optMap);

      setCurrentAssignment({
        id: record.id,
        title: record.title,
        questions: retryQuestions,
        isRetryMode: true
      });
      setStudentAnswers({});
      setUploadedImages({});
      setProgressMilestones(new Set());
      resetQuestionTimers();
      setIsDoModalVisible(true);
      message.info(`请重新作答 ${retryQuestions.length} 道错题`);
    } catch (e: any) {
      message.error(e.response?.data?.error || '获取重做错题失败');
    }
  };

  const handleViewStatistics = async (record: any) => {
    try {
      setStatsLoading(true);
      setIsStatsModalVisible(true);
      setStatsData(null);
      const res = await assignmentAPI.getStatistics(record.id);
      setStatsData(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '获取统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  const renderQuestionForStudent = (q: Question, index: number) => {
    // 记录该题首次进入视野的时刻，用于统计作答耗时。
    // 只写 ref、不触发渲染，因此可在渲染期直接调用（不能在此用 useEffect，那会违反 Hooks 规则）。
    if (isDoModalVisible && !isTeacher && q.id != null) markQuestionViewed(q.id);
    const isEssay = q.type === 'essay';
    // 学生端需要拍照上传的题型：简答题与作文题。
    // 原先只判 essay，导致作文（composition）没有上传入口——
    // 而作文恰恰是最需要拍照的题型，手写一篇要几百字。
    const isSubjectiveForAnswer = q.type === 'essay' || q.type === 'composition';
    const isChoiceSingle = q.type === 'choice_single';
    const isChoiceMulti = q.type === 'choice_multi';
    const isJudgment = q.type === 'judgment';
    const isFillBlank = q.type === 'fill_blank';
    const optShuffle = shuffledOptionMap[q.id!] || (q.options ? q.options.map((_: any, i: number) => i) : []);

    const mapDisplayToOriginal = (displayLetter: string): string => {
      const displayIdx = displayLetter.charCodeAt(0) - 65;
      const originalIdx = optShuffle[displayIdx];
      return originalIdx !== undefined ? String.fromCharCode(65 + originalIdx) : displayLetter;
    };

    const mapOriginalToDisplay = (originalLetter: string): string => {
      const originalIdx = originalLetter.charCodeAt(0) - 65;
      const displayIdx = optShuffle.indexOf(originalIdx);
      return displayIdx >= 0 ? String.fromCharCode(65 + displayIdx) : originalLetter;
    };

    return (
      <Card 
        key={q.id || q.tempId} 
        size="small" 
        style={{ marginBottom: 16, borderLeft: '4px solid #1890ff' }}
        title={<span>第 {index + 1} 题 <Tag color="blue">{typeOptions.find(t => t.value === q.type)?.label || q.type}</Tag>{q.knowledge_point && <Tag color="geekblue" style={{ marginLeft: 4 }}>🏷️ {q.knowledge_point}</Tag>}</span>}
      >
        <div style={{ marginBottom: 12, fontSize: 15, lineHeight: 1.8 }}>{q.content}</div>
        
        {(isChoiceSingle || isChoiceMulti) && q.options && (
          <div style={{ marginLeft: 8 }}>
            {isChoiceSingle ? (
              <Radio.Group 
                onChange={(e) => {
                  const originalLetter = mapDisplayToOriginal(e.target.value);
                  setStudentAnswers(prev => ({ ...prev, [q.id!]: originalLetter }));
                }}
                value={studentAnswers[q.id!] ? mapOriginalToDisplay(studentAnswers[q.id!]) : null}
                disabled={isTeacher}
              >
                {optShuffle.map((origIdx, displayIdx) => {
                  const displayLetter = String.fromCharCode(65 + displayIdx);
                  const origLetter = String.fromCharCode(65 + origIdx);
                  const isCorrect = isTeacher && q.answer && q.answer.split(',').map(a => a.trim()).includes(origLetter);
                  return (
                    <Radio key={displayIdx} value={displayLetter} style={{ marginBottom: 8, display: 'block', color: isCorrect ? '#52c41a' : undefined, fontWeight: isCorrect ? 600 : undefined }}>
                      <span style={{ fontWeight: 500, marginRight: 8 }}>{displayLetter}.</span>{q.options![origIdx]}{isCorrect && ' ✓'}
                    </Radio>
                  );
                })}
              </Radio.Group>
            ) : (
              <Checkbox.Group
                onChange={(vals) => {
                  const originalVals = vals.map((v: string) => mapDisplayToOriginal(v));
                  setStudentAnswers(prev => ({ ...prev, [q.id!]: originalVals }));
                }}
                value={studentAnswers[q.id!] ? (studentAnswers[q.id!] as string[]).map((v: string) => mapOriginalToDisplay(v)) : []}
                style={{ width: '100%' }}
                disabled={isTeacher}
              >
                {optShuffle.map((origIdx, displayIdx) => {
                  const displayLetter = String.fromCharCode(65 + displayIdx);
                  const origLetter = String.fromCharCode(65 + origIdx);
                  const isCorrect = isTeacher && q.answer && q.answer.split(',').map(a => a.trim()).includes(origLetter);
                  return (
                    <div key={displayIdx} style={{ marginBottom: 8, color: isCorrect ? '#52c41a' : undefined, fontWeight: isCorrect ? 600 : undefined }}>
                      <Checkbox value={displayLetter}>
                        <span style={{ fontWeight: 500, marginRight: 8 }}>{displayLetter}.</span>{q.options![origIdx]}{isCorrect && ' ✓'}
                      </Checkbox>
                    </div>
                  );
                })}
              </Checkbox.Group>
            )}
          </div>
        )}

        {isJudgment && (
          <Radio.Group 
            onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
            value={studentAnswers[q.id!] || null}
            style={{ marginLeft: 8 }}
            disabled={isTeacher}
          >
            <Radio value="true" style={{ marginRight: 24, color: isTeacher && q.answer === 'true' ? '#52c41a' : undefined, fontWeight: isTeacher && q.answer === 'true' ? 600 : undefined }}>正确{isTeacher && q.answer === 'true' ? ' ✓' : ''}</Radio>
            <Radio value="false" style={{ color: isTeacher && q.answer === 'false' ? '#52c41a' : undefined, fontWeight: isTeacher && q.answer === 'false' ? 600 : undefined }}>错误{isTeacher && q.answer === 'false' ? ' ✓' : ''}</Radio>
          </Radio.Group>
        )}

        {isFillBlank && !isTeacher && (
          <div style={{ marginLeft: 8 }}>
            <Input
              placeholder="在此填写答案..."
              value={studentAnswers[q.id!] || ''}
              onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
              style={{ maxWidth: 480 }}
            />
            <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 12 }}>
              如果题目有多个空，答案之间用英文逗号分隔
            </div>
          </div>
        )}

        {isSubjectiveForAnswer && !isTeacher && (
          <>
            <TextArea
              rows={4}
              placeholder="在此输入你的答案（手写作文可以直接拍照上传，不用打字）"
              value={studentAnswers[q.id!] || ''}
              onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
              style={{ marginBottom: 8 }}
            />
            {/* 图片入口必须写清「本题」。
                作文题往往排在整份作业的最后，按钮又在文字框下面，
                很容易被当成「上传整份作业的卷子」。 */}
            <div style={{
              border: '1px dashed #d9d9d9', borderRadius: 8, padding: 10, background: '#fafafa',
            }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                手写方便？拍下<strong>本题</strong>的作答照片，AI 会读出内容来评分。
                <br />
                <span style={{ color: '#999' }}>
                  只针对<strong>第 {index + 1} 题</strong>，与其他题目无关；不需要联网时可以先离线写好再拍照。
                </span>
              </div>
              <Upload
                beforeUpload={(file) => { handleUploadImage(q.id!, file); return false; }}
                showUploadList={false}
                accept="image/*"
              >
                <Button icon={<CameraOutlined />} size="small">
                  {uploadedImages[q.id!] ? `更换第 ${index + 1} 题的作答照片` : `上传第 ${index + 1} 题作答照片`}
                </Button>
              </Upload>
              {uploadingImageFor === q.id && (
                <span style={{ marginLeft: 10, fontSize: 12, color: '#1890ff' }}>正在压缩并上传…</span>
              )}
              {uploadedImages[q.id!] && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 4 }}>
                    ✓ 已上传第 {index + 1} 题的作答照片
                  </div>
                  <Image src={uploadedImages[q.id!]} width={200} style={{ borderRadius: 6 }} />
                </div>
              )}
            </div>
            <Alert
              type="warning"
              showIcon
              message="主观题仅有一次提交机会，请确认答案后提交"
              style={{ marginTop: 8 }}
            />
          </>
        )}

        {isEssay && isTeacher && (
          <div style={{ marginTop: 8 }}>
            {q.answer && (
              <div style={{ padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', marginBottom: 8 }}>
                <div style={{ color: '#52c41a', fontSize: 12, marginBottom: 4 }}>评阅标准：</div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{q.answer}</div>
              </div>
            )}
            {q.explanation && (
              <div style={{ color: '#8c8c8c', fontSize: 12, fontStyle: 'italic' }}>
                解析：{q.explanation}
              </div>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => {
              setEditingQuestion(q);
              setEditingQuestionIndex(-1);
              setEditingVariantParentIndex(-1);
              setEditingVariantIndex(-1);
              pendingEditValues.current = {
                content: q.content,
                options: q.options ? q.options.join('\n') : '',
                difficulty: q.difficulty || 'medium',
                knowledge_point: q.knowledge_point || '',
                answer: q.answer || '',
                explanation: q.explanation || '',
                analysis: q.analysis || ''
              };
              setEditModalVisible(true);
            }} style={{ marginTop: 4 }}>编辑</Button>
          </div>
        )}

        {isTeacher && q.answer && !isEssay && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="green">正确答案：{q.answer}{isJudgment && (q.answer === 'true' ? '（正确）' : '（错误）')}</Tag>
            <Button size="small" icon={<EditOutlined />} onClick={() => {
              setEditingQuestion(q);
              setEditingQuestionIndex(-1);
              setEditingVariantParentIndex(-1);
              setEditingVariantIndex(-1);
              let answerVal: any = q.answer || '';
              if (q.type === 'choice_multi' && typeof answerVal === 'string') {
                answerVal = answerVal.split(',').map((a: string) => a.trim()).filter(Boolean);
              }
              pendingEditValues.current = {
                content: q.content,
                options: q.options ? q.options.join('\n') : '',
                difficulty: q.difficulty || 'medium',
                knowledge_point: q.knowledge_point || '',
                answer: answerVal,
                explanation: q.explanation || '',
                analysis: q.analysis || ''
              };
              setEditModalVisible(true);
            }}>编辑</Button>
          </div>
        )}

        {isTeacher && q.explanation && (
          <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 12, fontStyle: 'italic' }}>
            解析：{q.explanation}
          </div>
        )}

        {isTeacher && (q as any).variants && (q as any).variants.length > 0 && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: '#fffbe6', border: '1px dashed #ffe58f', borderRadius: 6 }}>
            <div style={{ color: '#d48806', fontSize: 12, marginBottom: 6 }}>📋 备用变体题目（{(q as any).variants.length}道）</div>
            {(q as any).variants.map((v: any, vi: number) => (
              <div key={vi} style={{ padding: '6px 8px', background: '#fff', borderRadius: 4, marginBottom: 4, border: '1px solid #ffe58f' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <Tag color="orange">变体{vi + 1}</Tag>
                    <span style={{ fontSize: 13 }}>{v.content}</span>
                  </div>
                  <Button size="small" icon={<EditOutlined />} onClick={() => {
                    setEditingQuestion(v);
                    setEditingQuestionIndex(-1);
                    setEditingVariantParentIndex(-1);
                    setEditingVariantIndex(-1);
                    let answerVal: any = v.answer || '';
                    if (v.type === 'choice_multi' && typeof answerVal === 'string') {
                      answerVal = answerVal.split(',').map((a: string) => a.trim()).filter(Boolean);
                    }
                    pendingEditValues.current = {
                      content: v.content,
                      options: v.options ? v.options.join('\n') : '',
                      difficulty: v.difficulty || 'medium',
                      knowledge_point: v.knowledge_point || '',
                      answer: answerVal,
                      explanation: v.explanation || '',
                      analysis: v.analysis || ''
                    };
                    setEditModalVisible(true);
                  }}>编辑</Button>
                </div>
                {v.options && v.options.length > 0 && (
                  <div style={{ marginTop: 4, paddingLeft: 20, fontSize: 12 }}>
                    {v.options.map((opt: string, oi: number) => {
                      const optLetter = String.fromCharCode(65 + oi);
                      const isCorrect = v.answer && v.answer.split(',').map((a: string) => a.trim()).includes(optLetter);
                      return (
                        <span key={oi} style={{ marginRight: 12, color: isCorrect ? '#52c41a' : '#8c8c8c', fontWeight: isCorrect ? 600 : 400 }}>
                          {optLetter}. {opt}{isCorrect && ' ✓'}
                        </span>
                      );
                    })}
                  </div>
                )}
                {v.answer && <Tag color="green" style={{ marginTop: 4 }}>答案：{v.answer}</Tag>}
                {v.explanation && (
                  <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 11, fontStyle: 'italic' }}>
                    解析：{v.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  const renderResultItem = (r: any, index: number) => (
    <Card key={index} size="small" style={{ marginBottom: 12, borderLeft: `4px solid ${r.is_correct ? '#52c41a' : '#ff4d4f'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 4 }}>
            <strong>第{index + 1}题</strong>
            {r.is_correct ? (
              <Tag icon={<CheckCircleOutlined />} color="success">正确 ✓</Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">错误 ✗</Tag>
            )}
          </div>
          <div style={{ color: '#666', marginBottom: 6, lineHeight: 1.6 }}>{r.question_content}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>你的答案：<span style={{ color: r.is_correct ? '#52c41a' : '#ff4d4f', fontWeight: 600, fontSize: 14 }}>{String(r.user_answer ?? '(未作答)')}</span></span>
            {!r.is_correct && r.correct_answer && (
              <span>正确答案：<span style={{ color: '#52c41a', fontWeight: 600, fontSize: 14 }}>{String(r.correct_answer)}</span></span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 60 }}>
          <Statistic title="得分" value={Math.round(r.score || 0)} suffix={`/ ${Math.round(r.max_score || 0)}`} valueStyle={{ fontSize: 18, color: r.is_correct ? '#52c41a' : '#ff4d4f' }} />
        </div>
      </div>
      {(r.explanation || r.analysis) && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: '#f6ffed', borderRadius: 8, fontSize: 13, lineHeight: 1.7, border: '1px solid #b7eb8f' }}>
          <strong style={{ color: '#389e0d' }}>💡 解析：</strong><span style={{ color: '#333' }}>{r.explanation || r.analysis}</span>
        </div>
      )}
    </Card>
  );

  const getEncouragement = (score: number) => {
    if (score >= 95) return { text: '太棒了！满分接近！继续保持！🎉', color: '#52c41a' };
    if (score >= 80) return { text: '很不错！再接再厉，争取更好！👍', color: '#1890ff' };
    if (score >= 60) return { text: '及格了！多复习错题，下次会更好！💪', color: '#faad14' };
    return { text: '别灰心！查看错题本，弄懂每道题！📚', color: '#ff4d4f' };
  };

  // 截止日期允许为空（历史/演示作业），为空表示不限时间，避免显示 Invalid Date
  const isOverdue = (date?: string) => {
    if (!date) return false;
    const d = dayjs(date);
    return d.isValid() && d.isBefore(dayjs());
  };

  const formatDueDate = (date?: string) => {
    if (!date) return '不限时间';
    const d = dayjs(date);
    return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '不限时间';
  };

  // 分数保留 1 位小数，避免出现 175.27151082299451 这类浮点尾数
  const formatScore = (score: any) => {
    const n = Number(score);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10) / 10;
  };

  const getTypeTag = (t?: string) => {
    if (!t || t === 'homework') return null;
    if (t === 'preview') return <Tag color="purple">预习</Tag>;
    if (t === 'review') return <Tag color="orange">复习</Tag>;
    return null;
  };

  /**
   * 作业状态标签。
   *
   * 关键：必须先判AI 评阅状态。
   * 主观题提交后是异步评阅的，此时 my_score 还是 null，
   * 之前直接 formatScore(null) = 0，于是「正在评阅」被显示成红色的
   * 「需努力 0分」——学生看到的是自己答错了一大片。
   */
  const getStatusTag = (record: any) => {
    if (record.status === 'cancelled') return <Tag color="default" icon={<StopOutlined />}>已取消</Tag>;
    if (!record.my_submission_id) {
      if (isOverdue(record.due_date)) return <Tag color="error" icon={<CloseCircleOutlined />}>已过期</Tag>;
      return <Tag color="processing">待完成</Tag>;
    }
    if (record.my_submission_status === 'retry_available') return <Tag color="warning" icon={<ReloadOutlined />}>可重做</Tag>;

    // 已提交但AI 还没判完：pending=排队中/有题未评完，reviewing=正在评
    const reviewStatus = record.my_review_status;
    if (reviewStatus === 'reviewing') {
      return <Tag color="processing" icon={<LoadingOutlined />}>AI 评阅中</Tag>;
    }
    if (reviewStatus === 'pending') {
      return (
        <Tag color="processing" icon={<ClockCircleOutlined />}>
          待评阅
        </Tag>
      );
    }

    const score = formatScore(record.my_score);
    if (score >= 90) return <Tag color="success" icon={<CheckCircleOutlined />}>优秀 {score}分</Tag>;
    if (score >= 60) return <Tag color="blue">及格 {score}分</Tag>;
    return <Tag color="error">需努力 {score}分</Tag>;
  };

  const columns = [
    { title: '作业标题', dataIndex: 'title', key: 'title', render: (text: string, r: any) => (
      <div>
        <a style={{ fontWeight: 500 }}>{text}</a>
        {getTypeTag(r.assignment_type) && <span style={{ marginLeft: 6 }}>{getTypeTag(r.assignment_type)}</span>}
        {/* 跨教师作业可见开启时，标明这条是谁布置的，避免误以为是自己的作业 */}
        {isTeacher && r.teacher_id !== user?.id && r.teacher_name && (
          <Tag color="cyan" style={{ marginLeft: 6, fontSize: 11 }}>{r.teacher_name} 布置</Tag>
        )}
        {r.my_submission_id && (
          <div style={{ fontSize: 12, color: '#999' }}>
            最高得分：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{formatScore(r.my_score)}</span> 分
            {r.my_gold_reward > 0 && <span style={{ color: '#faad14', marginLeft: 8 }}>+{r.my_gold_reward}💰</span>}
          </div>
        )}
      </div>
    )},
    { title: '班级', dataIndex: 'class_name', key: 'class_name', responsive: ['md'] as any, render: (name: string) => name ? <Tag color="green">{name}</Tag> : <Tag>未分班</Tag> },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (subject: string) => <Tag color="blue">{subject}</Tag> },
    { title: '题型', dataIndex: 'question_type', key: 'question_type', responsive: ['md'] as any, render: (type: string) => <Tag color="purple">{questionTypeLabel(type)}</Tag> },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count', responsive: ['md'] as any, render: (count: number) => count ?? '-' },
    // 班级人数 / 已作答 是教师与管理员视角的统计，学生看到没有意义，故不显示
    ...(isTeacher ? [
      { title: '班级人数', dataIndex: 'class_student_count', key: 'class_student_count', responsive: ['md'] as any, render: (count: number) => count ?? '-' },
      { title: '已作答', dataIndex: 'submitted_count', key: 'submitted_count', responsive: ['md'] as any, render: (count: number, r: any) => {
        const total = r.class_student_count || 0;
        const submitted = count || 0;
        const unsubmitted = total - submitted;
        return (
          <span>
            <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{submitted}</span>
            {total > 0 && unsubmitted > 0 && (
              <span style={{ color: '#ff4d4f', marginLeft: 4 }}>（{unsubmitted}人未做）</span>
            )}
            {total > 0 && unsubmitted === 0 && (
              <span style={{ color: '#52c41a', marginLeft: 4 }}>（全部完成）</span>
            )}
          </span>
        );
      }},
    ] : []),
    // 作答时间：首次作答 ~ 最后作答 + 总耗时（来自逐题答题时间）
    { title: '作答时间', key: 'my_answer_time', responsive: ['md'] as any, render: (_: any, r: any) => {
        if (isTeacher || !r.my_submission_id) return <span style={{ color: '#bbb' }}>-</span>;
        const first = r.my_first_answered_at;
        const last = r.my_last_answered_at || first;
        if (!first) return <span style={{ color: '#bbb' }}>-</span>;
        const start = new Date(first);
        const end = last ? new Date(last) : start;
        const sameDay = start.toDateString() === end.toDateString();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timeText = sameDay
          ? `${pad(start.getHours())}:${pad(start.getMinutes())} ~ ${pad(end.getHours())}:${pad(end.getMinutes())}`
          : `${start.toLocaleDateString()} ${pad(start.getHours())}:${pad(start.getMinutes())} ~ ${end.toLocaleDateString()} ${pad(end.getHours())}:${pad(end.getMinutes())}`;
        const minutes = Math.max(1, Math.round((r.my_duration_ms || 0) / 60000));
        return (
          <div style={{ fontSize: 12, color: '#666' }}>
            <div>{timeText}</div>
            <div style={{ color: '#999' }}>用时约 {minutes} 分钟</div>
          </div>
        );
      }
    },
    { title: '金币奖励', dataIndex: 'max_exp', key: 'max_exp', responsive: ['md'] as any, render: (exp: number) => <span style={{ color: '#faad14', fontWeight: 'bold' }}>+{exp} 金币</span> },
    { 
      title: '截止日期', dataIndex: 'due_date', key: 'due_date', responsive: ['sm'] as any,
      render: (date: string) => {
        const overdue = isOverdue(date);
        return <span style={{ color: overdue ? '#ff4d4f' : undefined, fontWeight: overdue ? 'bold' : undefined }}>
          {formatDueDate(date)}
          {overdue && <span style={{ marginLeft: 4 }}>(已过期)</span>}
        </span>;
      }
    },
    { title: '状态', key: 'status', width: 100, render: (_: any, record: any) => getStatusTag(record) },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_: any, record: any) => (
        <Space size="small" wrap>
          {!isTeacher && !record.my_submission_id && !isOverdue(record.due_date) && (
            <Button type="primary" size="small" onClick={() => handleStartDoing(record)}>去完成</Button>
          )}
          {!isTeacher && !record.my_submission_id && isOverdue(record.due_date) && (
            <Button type="primary" size="small" danger onClick={() => handleStartDoing(record)}>补交</Button>
          )}
          {!isTeacher && record.my_submission_id && record.my_submission_status === 'retry_available' && (
            <Button type="primary" size="small" style={{ background: '#faad14', borderColor: '#faad14' }} onClick={() => handleRetryWrongFromList(record)}>重做错题</Button>
          )}
          {!isTeacher && record.my_submission_id && (
            <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewResult(record)}>查看结果</Button>
          )}
          {isTeacher && (
            <>
              {record.teacher_id === user?.id && (
                <>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleStartDoing(record)}>编辑</Button>
                  <Button size="small" icon={<PrinterOutlined />} onClick={() => openPrintDialog(record)}>打印</Button>
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => setPaperRegister({ id: record.id, title: record.title })}>纸质登记</Button>
                  <Button size="small" icon={<CameraOutlined />} onClick={() => setPaperBatchRegister({ id: record.id, title: record.title })}>批量扫描</Button>
                </>
              )}
              <Button size="small" icon={<BarChartOutlined />} onClick={() => handleViewStatistics(record)}>统计</Button>
              {record.status !== 'cancelled' && record.teacher_id === user?.id && (
                <Popconfirm
                  title="确认取消此作业？"
                  description="已提交的成绩会保留，未提交的学生将无法继续作答"
                  onConfirm={async () => {
                    try {
                      await assignmentAPI.cancelAssignment(record.id);
                      message.success('作业已取消');
                      loadAssignments();
                    } catch (e: any) {
                      message.error(e.response?.data?.error || '取消失败');
                    }
                  }}
                  okText="确认取消"
                  cancelText="再想想"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<StopOutlined />}>取消</Button>
                </Popconfirm>
              )}
            </>
          )}
        </Space>
      ),
    },
  ];

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 12 }}>
        <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看作业</h3>
        <Button type="primary" onClick={() => window.location.href = '/login'}>前往登录</Button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 20, flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
          <h2 style={{ margin: 0 }}>📝 班级作业</h2>
          {isTeacher && classes.length > 1 && (
            <Select placeholder="筛选班级" allowClear style={{ width: isMobile ? '100%' : 160 }} onChange={(v) => setSelectedClass(v)} value={selectedClass}>
              {classes.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
            </Select>
          )}
          {isTeacher && (
            <Select placeholder="筛选科目" allowClear style={{ width: isMobile ? '100%' : 120 }} onChange={(v) => setFilterSubject(v)} value={filterSubject}>
              {subjectOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
            </Select>
          )}
          <Select placeholder="作业类型" allowClear style={{ width: isMobile ? '100%' : 120 }} onChange={(v) => setFilterAssignmentType(v)} value={filterAssignmentType}>
            <Option value="preview">预习</Option>
            <Option value="homework">作业</Option>
            <Option value="review">复习</Option>
          </Select>
          {isTeacher && (
            <DatePicker.RangePicker
              style={{ width: isMobile ? '100%' : 240 }}
              onChange={(dates) => setFilterDateRange(dates as any)}
              value={filterDateRange as any}
              placeholder={['开始日期', '结束日期']}
            />
          )}
        </div>
        <Space>
          {!isTeacher && (
            <Button icon={<BookOutlined />} onClick={async () => {
              try {
                const res = await assignmentAPI.getMyWrongQuestions();
                message.info(`你有 ${res.data.wrong_questions?.length || 0} 道错题`);
              } catch(e) {}
            }}>错题本</Button>
          )}
          {isTeacher && (
            <Button type="primary" icon={<RobotOutlined />} onClick={() => { discardGeneration(generatedData?.usage_id); setIsCreateModalVisible(true); setGeneratedData(null); pendingPublishDefaults.current = null; setCreateModalTab('generate'); setShowVariantQuestions({}); loadGenLimit(); }}>
              发布新作业
            </Button>
          )}
        </Space>
      </div>

      {/* 教师端学情概览：按时间维度（今日 / 近7 天 / 近 30 天）各一张卡片，
          每张卡片内再按预习/作业/复习拆分，便于横向对比不同时间段的完成情况。
          口径说明写在卡片底部，避免把「人次完成率」误读成「学生完成率」。 */}
      {isTeacher && statRanges.length > 0 && (
        <Row gutter={[12, 12]} style={{ marginBottom: 8 }}>
          {statRanges.map((r: any) => {
            const hasData = r.total_count > 0;
            return (
              <Col xs={24} sm={8} key={r.key}>
                <Card
                  size="small"
                  style={{ borderRadius: 8, height: '100%' }}
                  title={<span style={{ fontSize: 13 }}>{r.label}</span>}
                  extra={
                    r.fallback ? (
                      <Tag color="orange" style={{ fontSize: 11 }}>今日无作业</Tag>
                    ) : (
                      <Tooltip title={r.hint}><span style={{ color: '#bbb', fontSize: 11 }}>{r.hint}</span></Tooltip>
                    )
                  }
                >
                  {!hasData ? (
                    <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
                      该时段暂无作业
                    </div>
                  ) : (
                    <>
                      <Row align="middle" gutter={8}>
                        <Col flex="auto">
                          <div style={{ fontSize: 13, color: '#666' }}>{r.total_count} 份作业</div>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                            平均 {r.average_score} 分 · {r.submitted_count} 人次提交
                          </div>
                        </Col>
                        <Col>
                          <Progress
                            type="circle"
                            size={52}
                            percent={r.completion_rate}
                            format={(p) => `${p}%`}
                            strokeColor={r.completion_rate >= 80 ? '#52c41a' : r.completion_rate >= 50 ? '#1890ff' : '#faad14'}
                          />
                        </Col>
                      </Row>
                      <div style={{ marginTop: 8 }}>
                        {(r.by_type || []).filter((t: any) => t.assignment_count > 0).map((t: any) => (
                          <div key={t.assignment_type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', padding: '2px 0' }}>
                            <Tag
                              color={t.assignment_type === 'preview' ? 'purple' : t.assignment_type === 'review' ? 'orange' : 'blue'}
                              style={{ fontSize: 11, marginInlineEnd: 0 }}
                            >
                              {t.label}
                            </Tag>
                            <span>{t.assignment_count} 份</span>
                            <span style={{ marginLeft: 'auto' }}>完成率 {t.completion_rate}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
      {isTeacher && statRanges.length > 0 && (
        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 16, marginTop: -4 }}>
          完成率 = 已提交人次 ÷（应交人次），同一学生做多份作业会计多次；「近 7 天 / 近 30 天」均含今天，按北京时间计算。
        </div>
      )}

      {isMobile ? (
        <div>
          {assignments.length === 0 && !loading && <Empty description="暂无作业" />}
          {assignments.map((record: any) => (
            <Card key={record.id} size="small" style={{ marginBottom: 12, borderRadius: 8 }} onClick={() => {}}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>{record.title}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {getTypeTag(record.assignment_type)}
                    <Tag color="blue">{record.subject}</Tag>
                    {record.class_name && <Tag color="green">{record.class_name}</Tag>}
                    {getStatusTag(record)}
                  </div>
                </div>
                <span style={{ color: '#faad14', fontWeight: 'bold', fontSize: 13, whiteSpace: 'nowrap' }}>+{record.max_exp}💰</span>
              </div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                {record.question_count}道题 · 截止 {formatDueDate(record.due_date)}
                {isOverdue(record.due_date) && <span style={{ color: '#ff4d4f', marginLeft: 4 }}>已过期</span>}
              </div>
              {isTeacher && record.class_student_count !== undefined && (
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  班级人数：{record.class_student_count} · 已作答：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{record.submitted_count || 0}</span>
                  {record.class_student_count > 0 && (record.class_student_count - (record.submitted_count || 0)) > 0 && (
                    <span style={{ color: '#ff4d4f', marginLeft: 4 }}>（{record.class_student_count - (record.submitted_count || 0)}人未做）</span>
                  )}
                </div>
              )}
              {record.my_submission_id && (
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  最高得分：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{formatScore(record.my_score)}</span> 分
                  {record.my_gold_reward > 0 && <span style={{ color: '#faad14', marginLeft: 8 }}>+{record.my_gold_reward}💰</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isTeacher && !record.my_submission_id && !isOverdue(record.due_date) && (
                  <Button type="primary" size="small" onClick={() => handleStartDoing(record)}>去完成</Button>
                )}
                {!isTeacher && !record.my_submission_id && isOverdue(record.due_date) && (
                  <Button type="primary" size="small" danger onClick={() => handleStartDoing(record)}>补交</Button>
                )}
                {!isTeacher && record.my_submission_id && record.my_submission_status === 'retry_available' && (
                  <Button type="primary" size="small" style={{ background: '#faad14', borderColor: '#faad14' }} onClick={() => handleRetryWrongFromList(record)}>重做错题</Button>
                )}
                {!isTeacher && record.my_submission_id && (
                  <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewResult(record)}>查看结果</Button>
                )}
                {isTeacher && record.teacher_id === user?.id && (
                  <>
                    <Button size="small" icon={<EditOutlined />} onClick={() => handleStartDoing(record)}>编辑</Button>
                    <Button size="small" icon={<PrinterOutlined />} onClick={() => openPrintDialog(record)}>打印</Button>
                    <Button size="small" icon={<FileTextOutlined />} onClick={() => setPaperRegister({ id: record.id, title: record.title })}>登记</Button>
                    <Button size="small" icon={<CameraOutlined />} onClick={() => setPaperBatchRegister({ id: record.id, title: record.title })}>批量扫描</Button>
                  </>
                )}
                {isTeacher && (
                  <Button size="small" icon={<BarChartOutlined />} onClick={() => handleViewStatistics(record)}>统计</Button>
                )}
                {isTeacher && record.status !== 'cancelled' && record.teacher_id === user?.id && (
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => {
                    Modal.confirm({
                      title: '确认取消此作业？',
                      content: '已提交的成绩会保留，未提交的学生将无法继续作答',
                      okText: '确认取消',
                      cancelText: '再想想',
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await assignmentAPI.cancelAssignment(record.id);
                          message.success('作业已取消');
                          loadAssignments();
                        } catch (e: any) {
                          message.error(e.response?.data?.error || '取消失败');
                        }
                      }
                    });
                  }}>取消</Button>
                )}
              </div>
            </Card>
          ))}
          {assignments.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Space>
                <Button disabled={assignmentTablePage <= 1} onClick={() => setAssignmentTablePage(p => p - 1)}>上一页</Button>
                <span style={{ color: '#999' }}>{assignmentTablePage} / {Math.max(1, Math.ceil(assignments.length / assignmentTablePageSize))}</span>
                <Button disabled={assignmentTablePage >= Math.ceil(assignments.length / assignmentTablePageSize)} onClick={() => setAssignmentTablePage(p => p + 1)}>下一页</Button>
              </Space>
            </div>
          )}
        </div>
      ) : (
        <Table columns={columns} dataSource={assignments} rowKey="id" loading={loading} pagination={{
          current: assignmentTablePage,
          pageSize: assignmentTablePageSize,
          onChange: (page, size) => { setAssignmentTablePage(page); setAssignmentTablePageSize(size); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => `共 ${total} 条`
        }} scroll={{ x: true }} />
      )}

      {/* 纸质作业登记 */}
      {paperRegister && (
        <PaperRegister
          assignmentId={paperRegister.id}
          title={paperRegister.title}
          open={!!paperRegister}
          onClose={() => setPaperRegister(null)}
          onSaved={loadAssignments}
        />
      )}

      {/* 批量纸质登记：多张照片一次识别，AI 按卷面姓名自动分人 */}
      {paperBatchRegister && (
        <PaperBatchRegister
          assignmentId={paperBatchRegister.id}
          title={paperBatchRegister.title}
          open={!!paperBatchRegister}
          onClose={() => setPaperBatchRegister(null)}
          onSaved={loadAssignments}
        />
      )}

      {/* 打印纸质作业纸 */}
      <Modal
        title={`🖨️ 打印作业纸：${printTarget?.title || ''}`}
        open={!!printTarget}
        onCancel={() => setPrintTarget(null)}
        onOk={handlePrintPaper}
        okText="生成并打印"
        cancelText="取消"
        confirmLoading={printLoading}
        width={isMobile ? '95vw' : 560}
        destroyOnHidden
      >
        {printLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>正在加载题目与班级名单…</div>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="住校生无设备场景"
              description="打印后发给学生笔答，收上来用「批量扫描」拍照，AI 识别卷面姓名并按人判分。"
            />
            <Form layout="vertical">
              <Form.Item label="打印方式">
                <Radio.Group value={printMode} onChange={(e) => setPrintMode(e.target.value)}>
                  <Radio value="named">按名单预填姓名（每人一份）</Radio>
                  <Radio value="blank">空白卷（姓名留空）</Radio>
                </Radio.Group>
              </Form.Item>

              {printMode === 'named' && (
                <Form.Item
                  label={`选择学生（已选 ${printStudentIds.length} / ${printClassStudents.length} 人）`}
                  extra={printSubmittedIds.length > 0 ? `灰色为已提交过的学生，默认不勾选` : undefined}
                >
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Button size="small" onClick={() => setPrintStudentIds(printClassStudents.map(s => s.id))}>全选</Button>
                    <Button size="small" onClick={() => setPrintStudentIds(printClassStudents.filter(s => !printSubmittedIds.includes(s.id)).map(s => s.id))}>仅未提交</Button>
                    <Button size="small" onClick={() => setPrintStudentIds([])}>清空</Button>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
                    {printClassStudents.length === 0 ? (
                      <Empty description="该班级暂无学生" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <Checkbox.Group
                        style={{ width: '100%' }}
                        value={printStudentIds}
                        onChange={(v) => setPrintStudentIds(v as number[])}
                      >
                        <Row>
                          {printClassStudents.map(s => (
                            <Col span={8} key={s.id}>
                              <Checkbox
                                value={s.id}
                                style={{ color: printSubmittedIds.includes(s.id) ? '#bbb' : undefined }}
                              >
                                {s.real_name || s.username}
                                {printSubmittedIds.includes(s.id) ? '（已交）' : ''}
                              </Checkbox>
                            </Col>
                          ))}
                        </Row>
                      </Checkbox.Group>
                    )}
                  </div>
                </Form.Item>
              )}

              <Form.Item label="参考答案">
                <Checkbox checked={printShowAnswer} onChange={(e) => setPrintShowAnswer(e.target.checked)}>
                  在卷末附参考答案（教师讲评用，发给学生请勿勾选）
                </Checkbox>
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* 教师发布作业弹窗 */}
      <Modal
        title="🤖 发布新作业（AI智能生成）"
        open={isCreateModalVisible}
        onCancel={() => {
          const pendingUsageId = generatedData?.usage_id;
          setIsCreateModalVisible(false);
          setGeneratedData(null);
          // 生成了但没发布就关闭：撤销本次生成并退还额度
          discardGeneration(pendingUsageId, true).then((ok) => { if (ok) loadGenLimit(); });
        }}
        afterOpenChange={(open) => {
          if (!open) return;
          generateForm.resetFields();
          // 默认带出教师自己的任教科目，仍可手动改成其他科目
          if (mySubject) generateForm.setFieldsValue({ subject: mySubject });
          // 出题规格默认给一行，用加号再加（粘贴模式不用题型，故无需初始化）
          generateForm.setFieldsValue({
            type_specs: [defaultTypeSpec()],
          });
        }}
        width={isMobile ? '95vw' : 860}
        destroyOnHidden
        footer={null}
      >
        <Tabs activeKey={createModalTab} onChange={(key) => setCreateModalTab(key)} items={[
          {
            key: 'generate',
            label: '1. AI生成题目',
            children: (
              <Form form={generateForm} layout="vertical" onFinish={handleGenerateQuestions}>
                <Form.Item label="出题方式" style={{ marginBottom: 12 }}>
                  <Radio.Group value={genMode} onChange={(e) => setGenMode(e.target.value)} buttonStyle="solid" size={isMobile ? 'small' : 'middle'}>
                    <Radio.Button value="topic">按知识点出题</Radio.Button>
                    <Radio.Button value="requirements">按详细要求出题</Radio.Button>
                    <Radio.Button value="paste">粘贴题目</Radio.Button>
                  </Radio.Group>
                </Form.Item>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="subject"
                      label="科目"
                      initialValue={mySubject}
                      extra={mySubject ? `默认已选你的任教科目「${mySubject}」，可改成其他科目` : undefined}
                      rules={[{ required: true }]}
                    >
                      <Select placeholder="选择科目">
                        {subjectOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="grade_level" label="年级（可选）">
                      <Input placeholder="如：高一、初三" />
                    </Form.Item>
                  </Col>
                </Row>
                {genMode === 'topic' && (
                  <Form.Item name="topic" label="知识点主题" rules={[{ required: true }]} preserve={false}>
                    <Input placeholder="例如：二次函数顶点坐标、古诗词默写、牛顿第二定律..." />
                  </Form.Item>
                )}
                {genMode === 'requirements' && (
                  <Form.Item name="requirements" label="详细作业要求" rules={[{ required: true, message: '请填写详细的作业要求' }]} preserve={false}>
                    <TextArea rows={5} maxLength={2000} showCount placeholder={'用一段话详细描述你想布置的作业要求，AI会按要求生成题目。例如：\n围绕本单元"光的折射"出题，重点考查折射角与入射角的关系，多出生活情境应用题，不要涉及全反射相关内容。'} />
                  </Form.Item>
                )}
                {genMode === 'paste' && (
                  <Form.Item name="raw_text" label="粘贴题目原文" rules={[{ required: true, message: '请粘贴题目内容' }]} preserve={false}>
                    <TextArea rows={10} maxLength={10000} showCount placeholder={'直接把已有的题目（可从Word/PDF/网页复制）粘贴到这里，格式不必规范。AI会自动整理成标准格式、补全答案和解析，然后进入下一步预览确认。'} />
                  </Form.Item>
                )}

                {/* 粘贴整理模式：题型由 AI 逐题自动判断，不需要老师指定；题量也由素材决定 */}
                {genMode === 'paste' ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="直接粘贴原文即可，题型由 AI 自动判断"
                    description="不需要先选题型。AI 会逐题识别单选/多选/判断/填空/简答，并按各自格式补全选项与答案。识别不清的题会在预览里标出，检查一下再用。"
                  />
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>出题规格</div>
                    <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                      一行代表一种题型，可分别设置数量和难度；点加号可一次生成多种题型的题目（仍只消耗 1 次生成额度）。
                    </div>
                    <Form.List name="type_specs">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.length === 0 && (
                            <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>还没有题型，请点下方按钮添加。</div>
                          )}
                          {fields.map((field, idx) => (
                            <Row key={field.key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                              <Col flex="auto">
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'question_type']}
                                  rules={[{ required: true, message: '请选择题型' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select placeholder={`第 ${idx + 1} 行：题型`}>
                                    {typeOptions.map(t => <Option key={t.value} value={t.value}>{t.label}</Option>)}
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col flex="0 0 120px">
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'count']}
                                  rules={[{ required: true, message: '请填数量' }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <InputNumber min={1} max={20} style={{ width: '100%' }} suffix="道" />
                                </Form.Item>
                              </Col>
                              <Col flex="0 0 110px">
                                <Form.Item {...field} name={[field.name, 'difficulty']} style={{ marginBottom: 0 }}>
                                  <Select>
                                    {difficultyOptions.map(d => <Option key={d.value} value={d.value}>{d.label}</Option>)}
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col flex="0 0 36px">
                                <Popconfirm title="删除这一行的题型？" onConfirm={() => remove(field.name)} okText="删除" cancelText="取消">
                                  <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Col>
                            </Row>
                          ))}
                          <Button
                            type="dashed"
                            block
                            icon={<PlusOutlined />}
                            onClick={() => {
                              // 新行默认挑一个还没用过的题型，避免和已有行重复还要手动改
                              const used = new Set(((generateForm.getFieldValue('type_specs') || []) as any[]).map((r) => r?.question_type));
                              const next = typeOptions.find(t => !used.has(t.value))?.value || 'choice_single';
                              add({ question_type: next, count: 5, difficulty: 'medium' });
                            }}
                          >
                            加一种题型
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                )}
                <Button type="primary" htmlType="submit" block icon={generating ? <LoadingOutlined /> : <RobotOutlined />} loading={generating} disabled={genLimit ? genLimit.daily_remaining <= 0 : false}>
                  {generating ? 'AI正在处理中...' : genMode === 'paste' ? '🤖 AI整理题目' : genMode === 'requirements' ? '🤖 AI按要求生成题目' : '🤖 AI生成题目'}
                </Button>
                {/* 出题进度：多题型要跑几分钟，看得见进度才不会以为卡死而重复点击 */}
                {generating && genProgress && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: '#f6f8fa', borderRadius: 8 }}>
                    <Progress
                      percent={genProgress.percent}
                      status="active"
                      size="small"
                    />
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      {genProgress.current}
                      {genProgress.total > 1 && `（${genProgress.done}/${genProgress.total} 种题型已完成）`}
                      ，可以关掉弹窗，生成会在后台继续
                    </div>
                  </div>
                )}
                {genLimit && (
                  <Alert
                    style={{ marginTop: 12 }}
                    type={genLimit.daily_remaining > 0 ? 'info' : 'warning'}
                    showIcon
                    message={
                      genLimit.daily_remaining > 0
                        ? `今日剩余生成次数：${genLimit.daily_remaining} / ${genLimit.daily_limit}（次日0点重置）`
                        : `今日生成次数已用完（${genLimit.daily_limit}次），请明日0点后再试`
                    }
                    description="生成失败（格式有误、超时、没出有效题目）或生成后未发布就关闭，都不会消耗次数"
                  />
                )}
                {genLimit && genLimit.global_tokens_remaining < 100000 && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="warning"
                    showIcon
                    message={`全站Token余量较低，剩余约 ${(genLimit.global_tokens_remaining / 1000).toFixed(0)}K tokens`}
                  />
                )}
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 8 }}>
                  {genMode === 'paste'
                    ? '提示：AI会逐题判断题型并补全选项与答案，题目数量以实际内容为准（不含变体）'
                    : '提示：客观题（单选/多选/判断/填空）实际生成 N×3 道，每道题配 2 个相似变体；主观题按 N 道生成。'}
                </div>
              </Form>
            )
          },
          {
            key: 'preview',
            label: '2. 题目预览',
            disabled: !generatedData,
            children: generatedData ? (
              <div>
                <Alert 
                  type="info" 
                  showIcon 
                  message={genMode === 'paste'
                    ? `AI已整理${generatedData.question_count}道题目，请逐题检查内容与答案是否正确，点击"编辑"可修改`
                    : `共${generatedData.question_count}道主题，含${generatedData.total_generated}道含变体。点击"编辑"可修改题目内容/答案，点击"▼ 查看变体题目"查看备用题`}
                  style={{ marginBottom: 12 }} 
                  description={generatedData.warning}
                />
                {generatedData.spec_summary && generatedData.spec_summary.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    {generatedData.spec_summary.map((s, i) => (
                      <Tag key={i} color="purple" style={{ marginBottom: 4 }}>
                        {s.type_label} · {difficultyOptions.find(d => d.value === s.difficulty)?.label || s.difficulty} · 目标 {s.requested} 道 / 实得 {s.generated} 道
                      </Tag>
                    ))}
                  </div>
                )}
                <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                  {generatedData.questions.map((q, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: i % 2 === 0 ? '#fafafa' : '#fff', borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <strong>Q{i + 1}.</strong> <Tag color="purple">{typeOptions.find(t => t.value === q.type)?.label}</Tag>
                          <span style={{ marginLeft: 4 }}>{q.content}</span>
                          {q.knowledge_point && <Tag color="blue" style={{ marginLeft: 8 }}>🏷️ {q.knowledge_point}</Tag>}
                          {q.hasVariants && (
                            <Tag
                              color="orange"
                              style={{ marginLeft: 8, cursor: 'pointer' }}
                              onClick={() => setShowVariantQuestions(prev => ({ ...prev, [i]: !prev[i] }))}
                            >
                              {showVariantQuestions[i] ? '▲ 收起变体' : '▼ 查看变体题目'}
                            </Tag>
                          )}
                        </div>
                        <Space size="small" style={{ marginLeft: 8, flexShrink: 0 }}>
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditQuestion(q, i)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="small"
                            danger
                            onClick={() => handleDeleteQuestion(i)}
                          >
                            删除
                          </Button>
                        </Space>
                      </div>
                      {q.options && q.options.length > 0 && (
                        <div style={{ marginTop: 6, paddingLeft: 24, color: '#666', fontSize: 13 }}>
                          {q.options.map((opt, oi) => {
                            const optLetter = String.fromCharCode(65 + oi);
                            const isCorrect = q.answer && q.answer.split(',').map(a => a.trim()).includes(optLetter);
                            return (
                              <div key={oi} style={{ color: isCorrect ? '#52c41a' : '#666', fontWeight: isCorrect ? 600 : 400 }}>
                                {optLetter}. {opt}{isCorrect && ' ✓'}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {q.answer && (
                        <div style={{ marginTop: 4, paddingLeft: 24 }}>
                          <Tag color="green">答案：{q.answer}</Tag>
                          {q.type === 'judgment' && (q.answer === 'true' ? '（正确）' : '（错误）')}
                        </div>
                      )}
                      {q.explanation && (
                        <div style={{ marginTop: 4, paddingLeft: 24, color: '#8c8c8c', fontSize: 12, fontStyle: 'italic' }}>
                          解析：{q.explanation}
                        </div>
                      )}
                      {q.hasVariants && showVariantQuestions[i] && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: '#fffbe6', border: '1px dashed #ffe58f', borderRadius: 6 }}>
                          <div style={{ color: '#d48806', fontSize: 12, marginBottom: 6 }}>📋 备用变体题目（学生做错时推送相似题）</div>
                          {q.variants && q.variants.map((v: any, vi: number) => (
                            <div key={vi} style={{ padding: '6px 8px', background: '#fff', borderRadius: 4, marginBottom: 4, border: '1px solid #ffe58f' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                  <Tag color="orange">变体{vi + 1}</Tag>
                                  <span style={{ fontSize: 13 }}>{v.content}</span>
                                </div>
                                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditQuestion(v, -1, i, vi)} style={{ marginLeft: 8 }}>编辑</Button>
                              </div>
                              {v.options && v.options.length > 0 && (
                                <div style={{ marginTop: 4, paddingLeft: 20, fontSize: 12 }}>
                                  {v.options.map((opt: string, oi: number) => {
                                    const optLetter = String.fromCharCode(65 + oi);
                                    const isCorrect = v.answer && v.answer.split(',').map((a: string) => a.trim()).includes(optLetter);
                                    return (
                                      <span key={oi} style={{ marginRight: 12, color: isCorrect ? '#52c41a' : '#8c8c8c', fontWeight: isCorrect ? 600 : 400 }}>
                                        {optLetter}. {opt}{isCorrect && ' ✓'}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {v.answer && <Tag color="green" style={{ marginTop: 4 }}>答案：{v.answer}</Tag>}
                              {v.explanation && (
                                <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 11, fontStyle: 'italic' }}>
                                  解析：{v.explanation}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <Button type="primary" onClick={() => setCreateModalTab('publish')}>
                    确认题目，下一步 →
                  </Button>
                </div>
              </div>
            ) : (
              <Empty description="请先在第一步生成题目" />
            )
          },
          {
            key: 'publish',
            label: '3. 发布设置',
            disabled: !generatedData,
            children: generatedData ? (
              <Form form={form} layout="vertical" onFinish={handleCreateAssignment}>
                {(isAdmin || user?.role === 'teacher') && (
                  <Form.Item name="class_ids" label="发布到班级" rules={[{ required: true, message: '请选择至少一个班级' }]}>
                    <Select mode="multiple" placeholder="选择班级（可多选）" maxTagCount={5}>{classes.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}</Select>
                  </Form.Item>
                )}
                <Form.Item name="title" label="作业标题" rules={[{ required: true }]} initialValue={generatedData.title}>
                  <Input />
                </Form.Item>
                <Form.Item
                  name="assignment_type"
                  label="作业类型"
                  initialValue="homework"
                  extra="住校生无设备时可将预习题打印成纸质卷，学生作答后拍照上传由 AI 判分"
                >
                  <Select>
                    <Option value="preview">预习（课前预习题）</Option>
                    <Option value="homework">作业（课后作业）</Option>
                    <Option value="review">复习（单元复习题）</Option>
                  </Select>
                </Form.Item>
                <Form.Item name="description" label="作业说明" initialValue={generatedData.description}>
                  <TextArea rows={2} />
                </Form.Item>

                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="max_exp" label="金币奖励" rules={[{ required: true }]} initialValue={30}>
                      <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="金币" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="due_date" label="截止日期" rules={[{ required: true }]}>
                      <DatePicker showTime style={{ width: '100%' }} disabledDate={(current) => current && current < dayjs().startOf('day')} />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item name="question_type" hidden initialValue={generatedData.question_type}><Input /></Form.Item>
                <Form.Item name="subject" hidden initialValue={generatedData.subject}><Input /></Form.Item>

                <Button type="primary" htmlType="submit" block>确认发布作业</Button>
              </Form>
            ) : (
              <Empty description="请先在第一步生成题目" />
            )
          }
        ]} />
      </Modal>

      {/* 学生作答弹窗 */}
      <Modal
        title={isTeacher ? `✏️ 编辑作业: ${currentAssignment?.title || ''}` : `📝 ${currentAssignment?.isRetryMode ? '错题重做' : '完成作业'}: ${currentAssignment?.title || ''}`}
        open={isDoModalVisible}
        onCancel={() => setIsDoModalVisible(false)}
        width={isMobile ? '95vw' : 700}
        destroyOnHidden
        confirmLoading={submitting}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' } }}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {!isTeacher && (
              <div style={{ flex: 1 }}>
                <Progress 
                  percent={Math.round(((currentAssignment?.questions || []).filter((q: Question) => {
                    const a = studentAnswers[q.id!];
                    return a !== undefined && a !== null && a !== '';
                  }).length / (currentAssignment?.questions?.length || 1)) * 100)} 
                  status="active"
                  size="small"
                  format={(_p) => `已完成 ${(currentAssignment?.questions || []).filter((q: Question) => studentAnswers[q.id!] !== undefined && studentAnswers[q.id!] !== null && studentAnswers[q.id!] !== '').length}/${currentAssignment?.questions?.length || 0} 题`}
                />
              </div>
            )}
            <Button onClick={() => setIsDoModalVisible(false)}>{isTeacher ? '关闭' : '取消'}</Button>
            {!isTeacher && (
              <Button
                type="primary"
                loading={submitting}
                disabled={!currentAssignment?.questions?.length}
                onClick={handleSubmitAnswers}
              >
                {submitting ? "提交中..." : "提交答案"}
              </Button>
            )}
          </div>
        }
      >
        {currentAssignment && (
          <div>
            <Alert 
              type={isTeacher ? "info" : currentAssignment.isRetryMode ? "warning" : "info"} 
              showIcon 
              message={
                isTeacher 
                  ? `编辑模式 | 共${currentAssignment.questions?.length || 0}道题 | 点击"编辑"按钮修改题目或答案`
                  : currentAssignment.isRetryMode 
                    ? "这是根据你之前做错的题目生成的相似题，再试一次吧！" 
                    : `${currentAssignment.subject} | 共${currentAssignment.questions?.length || 0}道题 | 金币奖励: +${currentAssignment.max_exp}`
              } 
              style={{ marginBottom: 16 }} 
            />
            
            {(!currentAssignment.questions || currentAssignment.questions.length === 0) && !isTeacher && (
              <Empty description="该作业暂未添加题目，请联系老师补充题目后再作答" style={{ padding: '24px 0' }} />
            )}

            {currentAssignment.questions?.map((_: Question, _si: number) => {
              const i = shuffledQuestionOrder.length > 0 ? shuffledQuestionOrder[_si] : _si;
              return renderQuestionForStudent(currentAssignment.questions[i], _si);
            })}
          </div>
        )}
      </Modal>

      {/* 作答结果弹窗 */}
      <Modal
        title={submitResultAwaitingReview ? '📝 已提交，等待 AI 评阅' : '✅ 作答完成！'}
        open={isResultModalVisible}
        onCancel={() => setIsResultModalVisible(false)}
        width={isMobile ? '95vw' : 680}
        destroyOnHidden
        footer={
          <Space>
            {submitResult?.can_retry && (
              <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetryWrong}>重做错题</Button>
            )}
            {!isTeacher && (
              <Button onClick={() => { setIsResultModalVisible(false); onNavigate?.('wrong_questions'); }}>去错题本</Button>
            )}
            <Button onClick={() => setIsResultModalVisible(false)}>关闭</Button>
          </Space>
        }
      >
        {submitResult && (
          <div>
            {!submitResultAwaitingReview && (
              <>
                <Alert
                  type={submitResult.total_score >= 60 ? 'success' : 'warning'}
                  showIcon
                  message={getEncouragement(submitResult.total_score).text}
                  style={{ marginBottom: 16, fontSize: 15 }}
                />
                <div style={{ marginBottom: 20, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 500 }}>总进度</span>
                    <span style={{ fontWeight: 'bold', color: submitResult.total_score >= 60 ? '#52c41a' : '#ff4d4f' }}>{submitResult.total_score}分 / {submitResult.total_max_score}分</span>
                  </div>
                  <Progress
                    percent={submitResult.total_score}
                    strokeColor={submitResult.total_score >= 80 ? '#52c41a' : submitResult.total_score >= 60 ? '#faad14' : '#ff4d4f'}
                    size={[ '100%', 20 ]}
                    format={(percent) => `${percent}分`}
                  />
                </div>
              </>
            )}
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col xs={12} sm={8}>
                <Card size="small"><Statistic title="总分" value={submitResult.total_score} suffix={`/ ${submitResult.total_max_score}`} valueStyle={{ color: submitResult.total_score >= 60 ? '#52c41a' : '#ff4d4f', fontSize: 28 }} /></Card>
              </Col>
              <Col xs={12} sm={8}>
                <Card size="small"><Statistic title="获得金币" value={submitResult.gold_reward} prefix="+" suffix="枚 💰" valueStyle={{ color: '#faad14', fontSize: 28 }} /></Card>
              </Col>
              <Col xs={12} sm={8}>
                <Card size="small"><Statistic title="正确率" value={submitResult.total_count > 0 ? Math.round(submitResult.correct_count / submitResult.total_count * 100) : 0} suffix="%" valueStyle={{ fontSize: 28 }} /></Card>
              </Col>
            </Row>

            {/* Combo 与全对奖励 */}
            {(submitResult.combo_bonus > 0 || submitResult.perfect_bonus > 0) && (
              <Alert
                type="success"
                showIcon={false}
                style={{ marginBottom: 16, background: 'linear-gradient(90deg, #fff7e6 0%, #fff1b8 100%)', border: '1px solid #ffd591' }}
                message={
                  <div>
                    {submitResult.combo_label && (
                      <div style={{ fontSize: 15, fontWeight: 'bold', color: '#d46b08' }}>
                        {submitResult.combo_label}
                      </div>
                    )}
                    {submitResult.perfect_bonus > 0 && (
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: '#d4380d', marginTop: 4 }}>
                        🏆 全部答对！额外 +{submitResult.perfect_bonus} 金币
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      基础金币 {submitResult.base_gold_reward || 0}
                      {submitResult.combo_bonus > 0 && <span> + Combo {submitResult.combo_bonus}</span>}
                      {submitResult.perfect_bonus > 0 && <span> + 全对 {submitResult.perfect_bonus}</span>}
                      <span> = 共 {submitResult.gold_reward} 金币</span>
                    </div>
                  </div>
                }
              />
            )}

            <Divider orientation="left">答题详情</Divider>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {submitResult.results?.map((r: any, i: number) => renderResultItem(r, i))}

              {submitResultAwaitingReview && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="已提交，AI 正在后台评阅你的主观题"
                  description={
                    <span>
                      通常一两分钟内完成，你可以直接关掉去做别的。
                      评阅完成后，这份作业会显示分数，<strong>点下面的按钮可以立刻查看</strong>。
                      <br />
                      作文题如果你拍了作答照片，AI 会读出照片里的内容来评分。
                    </span>
                  }
                  action={
                    <Button size="small" loading={checkingResult} onClick={handleRefreshResult}>
                      刷新结果
                    </Button>
                  }
                />
              )}

              {submitResult.wrong_count > 0 && submitResult.results && (
                <Alert 
                  type="error" 
                  showIcon 
                  message={`${submitResult.wrong_count} 道题做错了`} 
                  description="已自动加入错题本，可以点击'重做错题'来练习相似题目" 
                  style={{ marginTop: 12 }} 
                />
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 统计面板弹窗 */}
      <Modal
        title={`📊 作业统计: ${statsData ? assignments.find(a => a.id === statsData.assignment_id)?.title : '加载中...'}`}
        open={isStatsModalVisible}
        onCancel={() => setIsStatsModalVisible(false)}
        width={isMobile ? '95vw' : 800}
        destroyOnHidden
        footer={<Button onClick={() => setIsStatsModalVisible(false)}>关闭</Button>}
      >
        {statsLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <LoadingOutlined style={{ fontSize: 36, color: '#1890ff' }} spin />
            <div style={{ marginTop: 16, color: '#999' }}>正在统计数据...</div>
          </div>
        ) : statsData ? (
          <div>
            {statsData.submitted_count === 0 ? (
              <Empty description="暂无学生提交，无法生成统计" style={{ padding: 40 }} />
            ) : (
            <>
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col xs={12} sm={8} md={6}><Card size="small"><Statistic title="全班人数" value={statsData.total_students} /></Card></Col>
              <Col xs={12} sm={8} md={6}><Card size="small"><Statistic title="已提交" value={statsData.submitted_count} /></Card></Col>
              <Col xs={12} sm={8} md={6}><Card size="small"><Statistic title="完成率" value={statsData.completion_rate} suffix="%" valueStyle={{ color: statsData.completion_rate >= 80 ? '#52c41a' : '#ff4d4f' }} /></Card></Col>
              <Col xs={12} sm={8} md={6}><Card size="small"><Statistic title="平均分" value={statsData.average_score} /></Card></Col>
            </Row>

            <Tabs items={[
              {
                key: 'questions',
                label: '各题正确率',
                children: (
                  <div>
                    {statsData.question_stats?.map((qs: any, i: number) => (
                      <div key={i} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span><strong>第{i + 1}题</strong> <Tag>{typeOptions.find(t => t.value === qs.type)?.label || qs.type}</Tag>{qs.answer && <Tag color="green" style={{ marginLeft: 4 }}>答案：{qs.type === 'judgment' ? (qs.answer === 'true' ? '正确' : '错误') : qs.answer}</Tag>}</span>
                          <span>{qs.correct_rate}% ({qs.correct_count}/{qs.total_answers})</span>
                        </div>
                        <Progress percent={qs.correct_rate} status={qs.correct_rate >= 70 ? 'success' : qs.correct_rate >= 40 ? 'normal' : 'exception'} size="small" />
                        <div style={{ color: '#999', fontSize: 12 }}>{qs.content}...</div>
                      </div>
                    )) || <Empty />}
                  </div>
                )
              },
              {
                key: 'students',
                label: '学生明细',
                children: (
                  <Table
                    dataSource={statsData.student_results || []}
                    rowKey="submission_id"
                    size="small"
                    pagination={false}
                    scroll={{ x: true, y: 300 }}
                    columns={[
                      { title: '排名', key: 'rank', render: (_: any, __: any, i: number) => i + 1 },
                      { title: '姓名', dataIndex: 'real_name', render: (v: string, r: any) => v || r.username },
                      { title: '得分', dataIndex: 'total_score', render: (s: number) => s !== null ? s : '未批改' },
                      { title: '金币', dataIndex: 'gold_reward', render: (g: number) => g ? `+${g}` : 0 },
                      { title: '状态', dataIndex: 'review_status', render: (s: string) => s === 'completed' ? <Badge status="success" text="已完成" /> : s === 'reviewing' ? <Badge status="processing" text="评阅中" /> : <Badge status="default" text="待处理" /> },
                      { title: '提交时间', dataIndex: 'submitted_at', render: (t: string) => dayjs(t).format('MM-DD HH:mm') }
                    ]}
                  />
                )
              }
            ]} />
            </>
            )}
          </div>
        ) : null}
      </Modal>
      
      {/* 庆祝动画 */}
      <CelebrationAnimation
        show={showCelebration}
        expReward={celebrationData.expReward}
        goldReward={celebrationData.goldReward}
        leveledUp={celebrationData.leveledUp}
        newLevel={celebrationData.newLevel}
        evolved={celebrationData.evolved}
        newStage={celebrationData.newStage}
      />
      
      {/* 题目编辑弹窗 */}
      <Modal
        title="✏️ 编辑题目"
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingQuestion(null);
          setEditingQuestionIndex(-1);
        }}
        onOk={() => editForm.submit()}
        afterOpenChange={(open) => {
          if (open && pendingEditValues.current) {
            editForm.setFieldsValue(pendingEditValues.current);
            pendingEditValues.current = null;
          }
        }}
        width={isMobile ? '95vw' : 600}
        zIndex={2000}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" onFinish={handleSaveEdit}>
          <Form.Item name="content" label="题目内容" rules={[{ required: true, message: '请输入题目内容' }]}>
            <TextArea rows={4} placeholder="请输入题目内容..." />
          </Form.Item>
          
          {editingQuestion && ['choice_single', 'choice_multi', 'judgment'].includes(editingQuestion.type) && (
            <Form.Item name="options" label="选项（每行一个）" extra="如果题目没有选项，可以留空">
              <TextArea 
                rows={4} 
                placeholder={"A. 选项一\nB. 选项二\nC. 选项三\nD. 选项四"}
              />
            </Form.Item>
          )}

          {editingQuestion && editingQuestion.type === 'choice_single' && (
            <Form.Item name="answer" label="正确答案" rules={[{ required: true, message: '请选择正确答案' }]}>
              <Radio.Group>
                <Radio value="A">A</Radio>
                <Radio value="B">B</Radio>
                <Radio value="C">C</Radio>
                <Radio value="D">D</Radio>
              </Radio.Group>
            </Form.Item>
          )}

          {editingQuestion && editingQuestion.type === 'choice_multi' && (
            <Form.Item name="answer" label="正确答案（多选）" rules={[{ required: true, message: '请选择正确答案' }]}>
              <Checkbox.Group>
                <Checkbox value="A">A</Checkbox>
                <Checkbox value="B">B</Checkbox>
                <Checkbox value="C">C</Checkbox>
                <Checkbox value="D">D</Checkbox>
              </Checkbox.Group>
            </Form.Item>
          )}

          {editingQuestion && editingQuestion.type === 'judgment' && (
            <Form.Item name="answer" label="正确答案" rules={[{ required: true, message: '请选择正确答案' }]}>
              <Radio.Group>
                <Radio value="true">正确 ✓</Radio>
                <Radio value="false">错误 ✗</Radio>
              </Radio.Group>
            </Form.Item>
          )}

          {editingQuestion && editingQuestion.type === 'fill_blank' && (
            <Form.Item
              name="answer"
              label="正确答案"
              extra="多个空位时，答案之间用英文逗号分隔，顺序要与空位一致"
              rules={[{ required: true, message: '请输入正确答案' }]}
            >
              <Input placeholder="例如：北京 或 牛顿,第一定律" />
            </Form.Item>
          )}

          {editingQuestion && editingQuestion.type === 'essay' && (
            <>
              <Form.Item name="answer" label="参考答案 / 评阅标准" extra="替换AI生成的默认评阅标准，用于主观题评分参考">
                <TextArea rows={4} placeholder="请输入参考答案或评分标准..." />
              </Form.Item>
              <Form.Item name="analysis" label="答题思路指导" extra="帮助学生理解答题方向">
                <TextArea rows={3} placeholder="请输入答题思路..." />
              </Form.Item>
            </>
          )}

          <Form.Item name="explanation" label="解析" extra="题目解析，帮助学生理解正确答案">
            <TextArea rows={3} placeholder="请输入题目解析..." />
          </Form.Item>
          
          <Form.Item name="difficulty" label="难度">
            <Select>
              <Option value="easy">简单</Option>
              <Option value="medium">中等</Option>
              <Option value="hard">困难</Option>
            </Select>
          </Form.Item>
          
          <Form.Item name="knowledge_point" label="知识点">
            <Input placeholder="例如：勾股定理、三角函数..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Assignments;
