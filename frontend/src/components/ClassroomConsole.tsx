import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Select, InputNumber, Input, Tag, Avatar, Empty, Spin, message, Checkbox, Space, Modal, Table, Progress, Alert, Tooltip
} from 'antd';
import {
  LeftOutlined, RightOutlined, CloseOutlined, ThunderboltOutlined,
  GiftOutlined, UserSwitchOutlined, DeleteOutlined, StopOutlined, ReloadOutlined, SearchOutlined,
  SoundOutlined, PauseCircleOutlined, PlayCircleOutlined, AudioOutlined, BarChartOutlined,
  CheckCircleOutlined, CloseCircleOutlined, FileTextOutlined, EyeOutlined
} from '@ant-design/icons';
import { pinyin } from 'pinyin-pro';
import { classroomQuizAPI, itemAPI, equipmentAPI } from '../utils/api';
import { pollAiTask, AI_TASK_URLS } from '../utils/aiTask';
import { readPendingQuizJudge, writePendingQuizJudge, clearPendingQuizJudge } from '../utils/quizTaskResume';
import { judgeLocally, isLocalJudgeable, normalizeOptions, normalizeAnswer, type LocalJudgeResult } from '../utils/quizLocalJudge';
import { splitInlineOptions } from '../utils/classroomQuestionText';
import { useAuthStore } from '../store/authStore';
import { getPetThumbUrl } from '../utils/petImage';

const REWARD_TYPES: Record<string, string> = {
  gold: '金币',
  item: '物品',
  equipment: '装备',
  exp: '经验',
};

const QUICK_AMOUNTS = [1, 5, 10, 20, 50];
// QWERTY 键盘布局，符合输入习惯
const KEYPAD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const rarityLabel = (r: string) =>
  ({ common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' } as Record<string, string>)[r] || r;

/**
 * 「老师自己答题」时的占位答题人。
 * isTeacher 用来区分：判分结果要照常展示，但**不写进学生的答题记录、
 * 也不发金币**——那些是给学生的记录，老师自己回答不该占学生的名额。
 */
const TEACHER_ANSWERER = { id: -1, real_name: '教师', username: 'teacher', isTeacher: true };

/** 答题人展示名（学生取姓名，教师固定显示「教师」） */
const answererName = (s: any): string =>
  !s ? '' : (s.isTeacher ? '教师' : (s.real_name || s.username || ''));

/**
 * 作答区统一高度。
 * 客观题是按钮、主观题是输入框+按钮，两种内容天然高度不同；
 * 不锁minHeight 的话每换一题版面就跳一下，投影时尤其明显。
 */
const ANSWER_AREA_MIN_HEIGHT = 104;

/**
 * 投屏字号缩放范围。
 * 下限 0.5：后排学生看不清投屏时，0.7 倍仍然偏大，实际需要更小才看得清。
 * 上限 2.5：给最后一排自己调大看板用。
 */
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.5;
const FONT_SCALE_STEP = 0.1;

interface ConsoleProps {
  quiz: any;
  questions: any[];
  onClose: () => void;
  onRewarded: () => void;
}

const ClassroomConsole: React.FC<ConsoleProps> = ({ quiz, questions, onClose, onRewarded }) => {
  const { user } = useAuthStore();
  // 题目展示
  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoSeconds, setAutoSeconds] = useState(30);

  // 抢答倒计时
  const [buzzTotal, setBuzzTotal] = useState(30);
  const [buzzLeft, setBuzzLeft] = useState<number | null>(null);

  /**
   * 右侧学生名单是否展开。
   *
   * 课堂大屏上，左边的题目才是主角，名单常年占着三四十厘米宽度并不划算——
   * 多数时候老师只是需要「指定某个人回答」时扫一眼名单。所以默认折叠：
   * 需要点名时展开，不需要时把整块还给题目。
   *
   * 关键约定：折叠只藏名单，**不会丢掉「当前答题人是谁」**。
   * 随机点名抽中的人，即使名单折着，顶部工具栏与折叠条上也会一直挂着名字，
   * 老师随时知道现在该谁回答（见下面的答题人标记）。
   */
  const [studentPanelOpen, setStudentPanelOpen] = useState(false);

  // 学生面板
  const [students, setStudents] = useState<any[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // 随机点名
  const [randomState, setRandomState] = useState<{ rolling: boolean; name: string; student: any } | null>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 奖励表单
  const [rewardType, setRewardType] = useState('gold');
  const [rewardValue, setRewardValue] = useState<number | null>(10);
  const [rewardName, setRewardName] = useState('课堂奖励');
  const [rewardReason, setRewardReason] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const [rewarding, setRewarding] = useState(false);

  // 物品 / 装备列表
  const [items, setItems] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<any[]>([]);
  // 「已加载」与「正在加载」分开：只判断 length===0 的话，请求失败时下拉会永远转圈
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [equipmentsLoaded, setEquipmentsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [equipmentsLoading, setEquipmentsLoading] = useState(false);

  // 语音朗读（TTS）
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(() => localStorage.getItem('cls_tts_voice') || '');
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  // 语音答题 + AI 评判
  const [answerer, setAnswerer] = useState<any>(null);
  /**
   * 答题模式：还没定人 / 指定某位学生 / 老师自己 answering。
   *
   * 以前这里隐含假设「答题人一定是个学生」，于是没选人时：
   *   - 客观题点选项直接崩（judgeResult.student 是 null，渲染时读 .real_name 白屏）
   *   - 主观题提交 AI 判分只能弹窗把人拦下来
   * 但课堂上老师自己回答板书、带着学生一起讲，是很常见的用法。
   * 现在把「教师」也当成一种合法答题人，只是落库和发金币时要跳过。
   */
  const [answerMode, setAnswerMode] = useState<'none' | 'student' | 'teacher'>('none');
  /** 未定答题人时的三选一弹窗（随机点名 / 自己选学生 / 老师自己回答） */
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * 还没定答题人时点了某个选项——先记下来，选定答题人后接着把这次判分做完。
   * 没有这个中间态的话，老师点了 A、弹窗选完「教师回答」后还得再点一次 A。
   */
  /**
   * 上面那个 state 的 ref 镜像。
   * 随机点名要等 2 秒名字才停下来，那时读到的是旧闭包里的值，
   * 用 ref 拿到的才是「此刻」真实待处理的选项。
   */
  const pendingPickRef = useRef<string | null>(null);
  /**
   * 最近一次「点名」抽中的人。
   * 与 answerer 分开存是两个意思：
   *   answerer    现在正由谁回答（判分、发金币都算在他头上）
   *   pickedStudent 刚刚被随机抽到过（哪怕名单折着，也要看得出抽到了谁）
   * 两者可能不同：抽中后老师又手动点了别人当答题人，此时被抽到的那个人
   * 仍然值得一个标记，免得忘了刚才点到了谁。
   */
  const [pickedStudent, setPickedStudent] = useState<any>(null);
  const [answerText, setAnswerText] = useState('');
  const [listening, setListening] = useState(false);
  const [judging, setJudging] = useState(false);
  /**
   * 客观题本地作答：选中的选项键（多选可多个）。
   * 判分在浏览器里直接做完，不调 AI——单选/多选/判断本该是确定性判断，
   * 让大模型判不仅慢还花 token，且会给出「答对了给 95 分」这种含糊结果。
   */
  const [pickedKeys, setPickedKeys] = useState<string[]>([]);
  /** 本地判分的结果；null 表示还没作答或判不了（后者退回 AI 流程） */
  const [localResult, setLocalResult] = useState<LocalJudgeResult | null>(null);
  /** 「问 AI」答疑：老师手工选定答案后，可补一句学生的疑问交给 AI 讲解 */
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainQuestion, setExplainQuestion] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [explainProgress, setExplainProgress] = useState<{ percent: number; done: number; total: number; current: string } | null>(null);
  const [explainResult, setExplainResult] = useState<{ explanation: string; key_point: string } | null>(null);
  // AI 判分进度（后端后台执行，这里轮询刷新）
  const [judgeProgress, setJudgeProgress] = useState<{ percent: number; done: number; total: number; current: string } | null>(null);
  const [judgeSeconds, setJudgeSeconds] = useState(0);
  const [judgeResult, setJudgeResult] = useState<any>(null);
  const [perQValue, setPerQValue] = useState(10);
  // 本课堂的全部答题记录（服务端持久化，打开控制台即加载）
  const [records, setRecords] = useState<any[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // 投屏字号缩放
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('cls_font_scale') || '1');
    return isNaN(v) ? 1 : Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v));
  });
  const recRef = useRef<any>(null);
  /** 统一改字号：加减按钮与直接输入都走这里，保证钳制与持久化一致 */
  const applyFontScale = (v: number) => {
    const n = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(v) || 1));
    setFontScale(n);
    localStorage.setItem('cls_font_scale', String(n));
  };
  /** 接回未完成判分时的防重入闸：轮询已挂着就别再起第二个循环 */
  const judgeResumeInFlightRef = useRef(false);
  /** 进入控制台时只尝试恢复一次 */
  const judgeAutoResumedRef = useRef(false);

  // 题目课件 / 参考答案（有就显示按钮，课件可投屏给学生操作后再作答）
  const [showCourseware, setShowCourseware] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const currentQuestion = questions[index];

  // 换题时收起课件与答案，避免误把上一题的课件留在大屏上
  useEffect(() => {
    setShowCourseware(false);
    setShowAnswer(false);
  }, [index]);

  // 题目数量变化（重新进入课堂等）时把题号收回有效范围，避免大屏空白
  useEffect(() => {
    if (questions.length > 0 && index > questions.length - 1) {
      setIndex(questions.length - 1);
    }
  }, [questions.length, index]);

  // 打开控制台时自动接回上一次没跑完的 AI 判分。
// 老师误刷新、或切到别的课堂再回来时，之前那次判分不该白等——
// 判分结果会展示出来等TA确认，不会自动记进答题记录。
useEffect(() => {
  if (!user || !quiz?.id || judgeAutoResumedRef.current) return;
  judgeAutoResumedRef.current = true;
  if (readPendingQuizJudge(user.id)) {
    resumePendingJudge();
  }
}, [user, quiz?.id]);

// ===== 语音朗读 =====
  const loadVoices = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const vs: any[] = synth.getVoices() || [];
    if (vs.length === 0) return;
    // 按名称+语言去重
    const seen = new Set<string>();
    const uniq = vs.filter(v => {
      const k = `${v.name}|${v.lang}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // 全部列出，中文语音排最前
    const isZh = (v: any) => /^zh|cmn/i.test(v.lang) || /中文|汉语|普通话|Chinese/i.test(v.name);
    setVoices(uniq.sort((a, b) => (isZh(a) ? 0 : 1) - (isZh(b) ? 0 : 1)));
  };

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    // 部分浏览器语音列表延迟加载，多补几次
    const timers = [500, 1500, 3000].map(ms => setTimeout(loadVoices, ms));
    // 若只检测到一个声音，先"唤醒"一次语音引擎再重载（部分浏览器首次合成前不返回完整列表）
    const wake = setTimeout(() => {
      if ((synth.getVoices()?.length || 0) <= 1) {
        try {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          synth.speak(u);
        } catch (e) { /* 忽略 */ }
        setTimeout(loadVoices, 600);
      }
    }, 2000);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
      timers.forEach(clearTimeout);
      clearTimeout(wake);
      synth.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakText = (text?: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { message.warning('当前浏览器不支持语音朗读'); return; }
    const t = text || currentQuestion?.question_text || '';
    if (!t) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(t);
    const v = voices.find(x => x.voiceURI === voiceURI)
      || voices.find(x => /yunxi|云希/i.test(x.name))
      || voices.find(x => /zh/i.test(x.lang))
      || voices[0];
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-CN'; }
    u.onend = () => { setSpeaking(false); setPaused(false); };
    u.onerror = () => { setSpeaking(false); setPaused(false); };
    setSpeaking(true); setPaused(false);
    synth.speak(u);
  };

  const pauseSpeech = () => { window.speechSynthesis?.pause(); setPaused(true); };
  const resumeSpeech = () => { window.speechSynthesis?.resume(); setPaused(false); };
  const stopSpeech = () => { window.speechSynthesis?.cancel(); setSpeaking(false); setPaused(false); };

  // ===== 学生与拼音检索 =====
  const pyCache = useRef<Map<number, { full: string; initials: string }>>(new Map());
  const getPy = (s: any) => {
    const key = s.id;
    if (!pyCache.current.has(key)) {
      const name = s.real_name || s.username || '';
      let py = { full: '', initials: '' };
      try {
        py = {
          full: pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
          initials: pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
        };
      } catch (e) { /* 忽略 */ }
      pyCache.current.set(key, py);
    }
    return pyCache.current.get(key)!;
  };

  const loadStudents = async () => {
    setStudentsLoading(true);
    try {
      const res = await classroomQuizAPI.getClassStudents(quiz.class_id);
      const list: any[] = res.data.students || [];
      // 按姓名拼音排序，便于查找
      list.sort((a, b) => {
        const na = a.real_name || a.username || '';
        const nb = b.real_name || b.username || '';
        try {
          return pinyin(na, { toneType: 'none' }).localeCompare(pinyin(nb, { toneType: 'none' }));
        } catch (e) {
          return na.localeCompare(nb, 'zh');
        }
      });
      setStudents(list);
    } catch (e) {
      message.error('加载学生列表失败');
    } finally {
      setStudentsLoading(false);
    }
  };

  // 加载本课堂的全部答题记录
  const loadAnswers = async () => {
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      const list: any[] = res.data.answers || [];
      // 顺序：按时间正序展示
      const normalized = list.slice().reverse().map(a => ({
        ...a,
        questionIndex: Math.max(0, questions.findIndex(q => q.id === a.question_id)),
      }));
      setRecords(normalized);
    } catch (e) {
      // 加载失败不影响课堂进行
    }
  };

  useEffect(() => {
    loadStudents();
    loadAnswers();
    return () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 默认奖励名称（类型变化且未被手动修改时）
  useEffect(() => {
    if (!nameTouched) {
      setRewardName(rewardType === 'gold' ? '课堂奖励' : rewardType === 'exp' ? '课堂经验奖励' : '');
    }
    if (rewardType === 'gold' || rewardType === 'exp') {
      setRewardValue(10);
    } else {
      setRewardValue(null);
    }
    // 用教师专用的全量接口（/items/all）：原先复用了学生商店货架（/items），
    // 被 shop_enabled 开关和「可售类型」过滤双重拦截，403 又被 catch 吞掉，
    // 表现为选「物品」后下拉一片空白。
    if ((rewardType === 'item' && !itemsLoaded)) {
      setItemsLoading(true);
      itemAPI.getAllItems()
        .then((res: any) => { setItems(res.data.items || []); setItemsLoaded(true); })
        .catch((e: any) => message.error(e?.response?.data?.error || '物品列表加载失败，请稍后重试'))
        .finally(() => setItemsLoading(false));
    }
    if ((rewardType === 'equipment' && !equipmentsLoaded)) {
      setEquipmentsLoading(true);
      equipmentAPI.getAll()
        .then((res: any) => { setEquipments(res.data.equipments || []); setEquipmentsLoaded(true); })
        .catch((e: any) => message.error(e?.response?.data?.error || '装备列表加载失败，请稍后重试'))
        .finally(() => setEquipmentsLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardType]);

  // 默认奖励原因（题目切换且未被手动修改时）
  useEffect(() => {
    if (!reasonTouched) {
      setRewardReason(questions.length > 0 ? `第${index + 1}题回答正确` : '课堂表现优秀');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 切换题目时重置答题状态
  useEffect(() => {
    setJudgeResult(null);
    setAnswerText('');
    setAnswerer(null);
    stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 自动播放
  useEffect(() => {
    if (!autoPlay || questions.length === 0) return;
    const t = setInterval(() => setIndex(i => Math.min(i + 1, questions.length - 1)), autoSeconds * 1000);
    return () => clearInterval(t);
  }, [autoPlay, autoSeconds, questions.length]);

  // 抢答倒计时
  useEffect(() => {
    if (buzzLeft === null || buzzLeft <= 0) return;
    const t = setTimeout(() => setBuzzLeft(v => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [buzzLeft]);

  // AI评判已等待秒数
  useEffect(() => {
    if (!judging) return;
    setJudgeSeconds(0);
    const t = setInterval(() => setJudgeSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [judging]);

  // 键盘控制
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, Math.max(0, questions.length - 1)));
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [questions.length, onClose]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => {
      const name = (s.real_name || '').toLowerCase();
      const uname = (s.username || '').toLowerCase();
      if (name.includes(q) || uname.includes(q)) return true;
      const py = getPy(s);
      return py.full.includes(q) || py.initials.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, query]);

  const toggleRewardSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      filteredStudents.forEach(s => next.add(s.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // 将某个学生的卡片滚动到列表中间
  const scrollStudentIntoView = (id: number) => {
    setQuery(''); // 清空搜索，确保该学生显示在列表中
    setTimeout(() => {
      cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  /**
   * 指定答题人（手动点卡片 / 随机点名抽中）时把名单展开并滚到该学生。
   * 这两种都是「老师正要看着名单挑人」的场景，名单折着会挡住卡片。
   * 注意：折叠状态下顶部与折叠条仍会显示当前答题人，不会因此丢失信息。
   */
  const revealStudent = (s: any) => {
    setStudentPanelOpen(true);
    scrollStudentIntoView(s.id);
    // 点名是异步的（名字滚动约 2 秒才停），选人真正完成的那一刻才接上这次判分
    discardPendingPick();
  };

  // 随机点名（自动绑定为答题人）
  const startRandomPick = () => {
    if (students.length === 0) { message.warning('班级暂无学生'); return; }
    setRandomState({ rolling: true, name: '', student: null });
    let ticks = 0;
    const totalTicks = 25;
    if (rollTimer.current) clearInterval(rollTimer.current);
    rollTimer.current = setInterval(() => {
      const s = students[Math.floor(Math.random() * students.length)];
      setRandomState({ rolling: true, name: s.real_name || s.username, student: null });
      ticks++;
      if (ticks >= totalTicks && rollTimer.current) {
        clearInterval(rollTimer.current);
        rollTimer.current = null;
        setRandomState({ rolling: false, name: s.real_name || s.username, student: s });
        setAnswerer(s);
        setAnswerMode('student');
        setPickedStudent(s);
        // 抽中的人要看得见：自动展开名单并滚到那张卡片。
        // 万一老师又手动折叠了，顶部和折叠条上仍挂着「当前答题人」，
        // 随时知道该谁回答，不用重新点名。
        revealStudent(s);
      }
    }, 90);
  };

  // ===== 客观题本地判分 =====

/**
 * 当前题能否走本地秒判，以及要渲染哪些选项按钮。
 *
 * 两条取选项的路径：
 *   1. options 字段（AI 出题、题库选题、以及后端已拆分过的题）——首选
 *   2. 从题干纯文本里拆（库里改动之前建的题，options 列是空的）
 * 两条都拿不到才退回 AI 判分。
 */
const localOptions = useMemo(() => {
  if (!currentQuestion) return [];
  const fromField = normalizeOptions(currentQuestion.options);
  if (fromField.length) return fromField;
  const parsed = splitInlineOptions(currentQuestion.question_text);
  if (parsed) return normalizeOptions(parsed.options);
  return [];
}, [currentQuestion]);

/** 题干里内嵌了选项时，题干区只显示 stem，避免和下方按钮重复展示一遍 */
const localStem = useMemo(() => {
  if (!currentQuestion) return '';
  if (normalizeOptions(currentQuestion.options).length) return currentQuestion.question_text;
  return splitInlineOptions(currentQuestion.question_text)?.stem || currentQuestion.question_text;
}, [currentQuestion]);

const localJudgeable = !!currentQuestion && isLocalJudgeable(currentQuestion) && localOptions.length > 0;

/**
 * 当前生效的答题人：教师模式下是「教师」，否则是选中的学生（可能还没选）。
 * 判分结果一律用它填 student，渲染处就不会再读到 null。
 */
const effectiveAnswerer = answerMode === 'teacher' ? TEACHER_ANSWERER : answerer;

/** 换题时清掉上一题的作答与判分结果，别把 A 题的答案带到 B 题 */
useEffect(() => {
  setPickedKeys([]);
  setLocalResult(null);
  setAnswerText('');
  setExplainOpen(false);
  setExplainQuestion('');
  setExplainResult(null);
  // 换题要重新指定答题人：上一题是谁答的，和这一题没关系。
  // 否则老师切题后判分会算到上一题那个学生头上。
  setAnswerMode('none');
  setAnswerer(null);
  setPickedStudent(null);
}, [index]);

/**
 * 从判分结果里安全取答题人。
 *
 * 任何一条路径只要存进去的 student 是 null（历史记录、异常流程），
 * 渲染都不能崩——之前就是这里读 .real_name 导致整页白屏，
 * 一崩整个控制台就没了，连切题都做不了。
 */
const resultStudent = (r: any): any => r?.student ?? null;

/**
 * 点选项：单选/判断点一下即判，多选先攒着、等老师点「提交答案」。
 *
 * 还没指定答题人时不会直接判：先把这次点的选项记下来，弹出
 * 「随机点名 / 我自己选学生 / 教师自己回答」让人选，
 * 指定学生或随机点名时，之前点的那个选项要作废（见 discardPendingPick）：
 * 那个人是刚被指定的、还没开口回答。只有「教师自己回答」才提交那个选项。
 */
const pickOption = (key: string) => {
  if (!currentQuestion) return;
  if (answerMode === 'none') {
    pendingPickRef.current = key;
    setPickerOpen(true);
    return;
  }
  commitPick(key);
};

/** 真正执行一次本地判分（已确定答题人） */
const commitPick = (key: string) => {
  if (!currentQuestion) return;
  const isMulti = currentQuestion.question_type === 'choice_multi';
  const next = isMulti
    ? (pickedKeys.includes(key) ? pickedKeys.filter(k => k !== key) : [...pickedKeys, key])
    : [key];

  setPickedKeys(next);
  // 多选选完一个就提交语义不对，等老师点提交
  if (isMulti) {
    setLocalResult(null);
    return;
  }
  applyLocalJudge(next);
};

/**
 * 指定了某个学生之后，此前那次点击作废。
 *
 * 为什么不自动提交那个选项：老师点 A 时想的是「让某个学生答这题」，
 * 人定下来之后他是刚被指定的、还没开口回答。把老师随手点的 A 记成他的作答，
 * 会写进他的答题记录、还可能发金币，等于凭空造了一条不存在的作答记录。
 */
const discardPendingPick = () => {
  if (pendingPickRef.current === null) return;
  pendingPickRef.current = null;
  setPickedKeys([]);
  setLocalResult(null);
};

/** 用选中的选项做本地判分并写入答题记录 */
const applyLocalJudge = async (keys: string[], overrideWho?: any) => {
    if (!currentQuestion) return null;
    // 用当前解析出的选项构造判分入参：
    // 存量题的options 字段是空的，judgeLocally 只认 options，
    // 直接传原题会永远返回 null（于是又退回 AI 判分）
  const judgeTarget = {
    ...currentQuestion,
    options: localOptions.length ? localOptions : (currentQuestion.options ?? null),
  };
  const result = judgeLocally(judgeTarget, keys);
  if (!result) return null; // 判不了，调用方退回 AI 流程
  setLocalResult(result);

  // 兜底：答题人缺失时给占位对象，绝不让 null 流到渲染层。
  // 之前把 null 存进 judgeResult.student，渲染时读 .real_name 直接白屏，
  // 一崩整个控制台都没了，连切题都做不了。正常流程已在 pickOption 拦过，
  // 这里只是最后一道保险。
  //
  // overrideWho：教师自己回答时显式传入。setAnswerMode 是异步的，
  // 同一 tick 里读 effectiveAnswerer 拿到的还是旧值（null），
  // 所以用参数把「教师」这个身份直接传进来，不依赖 state 时序。
  const who = overrideWho
    || effectiveAnswerer
    || { id: 0, real_name: String(), username: String(), noAnswerer: true };
  setJudgeResult({
    is_correct: result.isCorrect,
    score: result.score,
    comment: result.isCorrect
      ? `回答正确（${result.studentAnswer}）`
      : `回答错误，正确答案是 ${result.correctAnswer}`,
    correct_answer: result.correctAnswer,
    student: who,
    answer: result.studentAnswer,
    questionIndex: index,
    coins: 0,
    localJudge: true,
  });

  // 只有「某个学生」作答才写进他的答题记录；老师自己回答不占学生名额
  if (who && !who.isTeacher) {
    try {
      const saved = await classroomQuizAPI.saveAnswer(quiz.id, {
        question_id: currentQuestion.id,
    student_id: who.id,
        answer_text: result.studentAnswer,
        judged_by_ai: false,
        judged_by: 'local',
        is_correct: result.isCorrect,
        score: result.score,
        coin_rewarded: 0,
      });
      setJudgeResult((prev: any) => ({ ...prev, answerId: saved.data.answer_id }));
    } catch (e) { /* 记录失败不影响判分展示 */ }
    loadAnswers();
  }
  return result;
};

// ===== 「问 AI」答疑 =====
/**
 * 把题目 + 学生答案 + 老师的疑问交给 AI 讲解。
 *
 * 与「提交AI评判」是两件事：判分本地已经秒判完了，AI 该做的是把「为什么」讲清楚。
 * 老师手工选定学生答案、再补一句学生的疑问就能用，不额外占生成次数。
 */
const handleExplain = async () => {
  if (!currentQuestion) return;
  if (!explainQuestion.trim()) {
    message.warning('请先填写学生的疑问，例如「为什么选 B 不选 C」');
    return;
  }
  const studentAnswer = localResult?.studentAnswer || answerText.trim();
  setExplaining(true);
  setExplainProgress({ percent: 0, done: 0, total: 1, current: 'AI 正在讲解（通常需 10-30 秒）' });
  try {
    const res = await classroomQuizAPI.aiExplain({
      subject: quiz.subject,
      question_text: currentQuestion.question_text,
      reference_answer: currentQuestion.answer_text || '',
      student_answer: studentAnswer || '未作答',
      student_question: explainQuestion.trim(),
    });
    const taskId: string | undefined = res.data?.task_id;
    if (!taskId) throw new Error('后端未返回任务号，请确认服务端已更新到最新版本');
    const r = await pollAiTask(taskId, AI_TASK_URLS.classroomQuizTask, setExplainProgress);
    setExplainResult({ explanation: r.explanation || '', key_point: r.key_point || '' });
  } catch (e: any) {
    message.error(e?.response?.data?.error || e?.message || 'AI答疑失败');
  } finally {
    setExplainProgress(null);
    setExplaining(false);
  }
};

// ===== 语音录入 =====
  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      message.warning('当前浏览器不支持语音识别，请使用Chrome/Edge，或在输入框手动录入');
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e: any) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        setAnswerText(t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch (e) {
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recRef.current?.stop(); } catch (e) { /* 忽略 */ }
    setListening(false);
  };

  // ===== AI 评判 =====
  /**
   * 判分结果落地。
   *
   * autoSave=true  是刚判完这一次，顺手把答案记进本课堂的答题记录；
   * autoSave=false 是「接回上次未完成的判分」——那时老师可能已经切到别的题、
   *   换了答题人，自动保存容易把判分记到别人头上，所以只展示，由TA确认后再存。
   */
  const showJudgeResult = async (
    r: any,
    ctx: { student: any; questionId?: number; studentId?: number; answer: string; questionIndex: number; autoSave: boolean }
  ) => {
    setJudgeResult({
      ...r,
      student: ctx.student,
      answer: ctx.answer,
      questionIndex: ctx.questionIndex,
      coins: 0,
      pendingSave: ctx.autoSave ? null : {
        questionId: ctx.questionId,
        studentId: ctx.studentId,
        answerText: ctx.answer,
      },
    });
    if (!ctx.autoSave) return;
    // autoSave=true 只来自「刚刚判完这一次」，题号与答题人必然都在；
    // 恢复路径不走这里（那批由老师点确认后再存）
    if (ctx.questionId == null || ctx.studentId == null) return;
    try {
      const saved = await classroomQuizAPI.saveAnswer(quiz.id, {
        question_id: ctx.questionId,
        student_id: ctx.studentId,
        answer_text: ctx.answer,
        judged_by_ai: true,
        is_correct: r.is_correct,
        score: r.score,
        coin_rewarded: 0,
      });
      setJudgeResult((prev: any) => ({ ...prev, answerId: saved.data.answer_id }));
    } catch (e) { /* 记录失败不影响展示 */ }
    loadAnswers();
    stopSpeech();
  };

  /** 老师确认后，把「接回来」的那次判分正式记入答题记录 */
  const savePendingJudge = async () => {
    const p = judgeResult?.pendingSave;
    if (!p?.questionId || !p?.studentId) return;
    try {
      const saved = await classroomQuizAPI.saveAnswer(quiz.id, {
        question_id: p.questionId,
        student_id: p.studentId,
        answer_text: p.answerText,
        judged_by_ai: true,
        is_correct: judgeResult.is_correct,
        score: judgeResult.score,
        coin_rewarded: 0,
      });
      setJudgeResult((prev: any) => ({ ...prev, answerId: saved.data.answer_id, pendingSave: null }));
      message.success('判分结果已保存到本课堂的答题记录');
      loadAnswers();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败，请重试');
    }
  };

  /**
   * 接回「上一次没跑完的 AI 判分」。
   *
   * 判分要等大模型读完学生的作答再给分，几十秒起步。老师可能误刷新、
   * 切到别的课堂再回来，原来那次判分就白跑了。存档里记着判的是哪道题、
   * 谁的作答，恢复出来仍能对上。
   */
  const resumePendingJudge = async (): Promise<boolean> => {
    if (!user || judgeResumeInFlightRef.current) return false;
    const stored = readPendingQuizJudge(user.id);
    if (!stored) return false;

    judgeResumeInFlightRef.current = true;
    setJudging(true);
    setJudgeProgress({ percent: 0, done: 0, total: 1, current: '正在接回上次未完成的 AI 评判…' });
    try {
      const r = await pollAiTask(stored.taskId, AI_TASK_URLS.classroomQuizTask, setJudgeProgress);
      clearPendingQuizJudge(user.id);
      const name = stored.studentName || '学生';
      await showJudgeResult(r, {
        student: { id: stored.studentId, real_name: name, username: name },
        questionId: stored.questionId,
        studentId: stored.studentId,
        answer: stored.studentAnswer,
        questionIndex: stored.questionIndex ?? 0,
        autoSave: false,
      });
      return true;
    } catch (e: any) {
      clearPendingQuizJudge(user.id);
      message.warning(e?.message || '上次未完成的 AI 评判已失效，请重新提交');
      return false;
    } finally {
      setJudgeProgress(null);
      setJudging(false);
      judgeResumeInFlightRef.current = false;
    }
  };

  const handleJudge = async () => {
    if (!currentQuestion) return;
    // 上一次判分还在后台跑：接回它看结果，而不是撞上 409 或重复提交一次
    if (readPendingQuizJudge(user?.id)) {
      if (await resumePendingJudge()) {
        message.info('已接回刚才未完成的 AI 评判，这是它的结果');
      }
      return;
    }
    if (!answerText.trim()) {
      message.warning('请先录入学生回答：点麦克风语音录入，或手动输入');
      return;
    }
    if (answerMode === 'none') {
      // 三选一：随机点名 / 我自己选学生 / 老师自己回答。
      // 「老师自己回答」是必须给的出口——课上老师经常自己先讲一遍，
      // 或带着全班一起答，这时并不存在「谁在回答」这回事。
      setPickerOpen(true);
      return;
    }
    const who = effectiveAnswerer;
    setJudging(true);
    judgeResumeInFlightRef.current = true;
    setJudgeProgress({ percent: 0, done: 0, total: 1, current: 'AI 正在评判作答' });
    const archive = {
      subject: quiz.subject,
      questionId: currentQuestion.id,
      questionText: currentQuestion.question_text,
      studentAnswer: answerText,
      studentId: who?.id,
      studentName: answererName(who),
      questionIndex: index,
      createdAt: Date.now(),
    };
    try {
      // 后端改为后台任务：提交只返回 task_id，判分过程靠轮询拿进度
      const res = await classroomQuizAPI.aiJudge({
        subject: quiz.subject,
        question_text: currentQuestion.question_text,
        student_answer: answerText,
      });
      const taskId: string | undefined = res.data?.task_id;
      if (!taskId) throw new Error('后端未返回任务号，请确认服务端已更新到最新版本');
      // 拿到任务号就存档：中途刷新/切走再回来，判分结果还能接回来
      writePendingQuizJudge(user?.id, { ...archive, taskId });

      const r = await pollAiTask(taskId, AI_TASK_URLS.classroomQuizTask, setJudgeProgress);
      clearPendingQuizJudge(user?.id);
      await showJudgeResult(r, {
      student: who,
        questionId: currentQuestion.id,
        studentId: who?.isTeacher ? undefined : who?.id,
        answer: answerText,
        questionIndex: index,
        autoSave: !who?.isTeacher,
      });
    } catch (e: any) {
      if (e?.response?.status === 409 && e?.response?.data?.task_id) {
        // 后端同类任务互斥：上一次那个判分还在跑，直接接回它
        writePendingQuizJudge(user?.id, { ...archive, taskId: e.response.data.task_id });
        message.warning('已有一个 AI 判分任务正在进行，已为你接上它的结果');
        judgeResumeInFlightRef.current = false;
        if (await resumePendingJudge()) return;
      } else {
        clearPendingQuizJudge(user?.id);
        message.error(e?.response?.data?.error || e?.message || 'AI评判失败');
      }
    } finally {
      setJudgeProgress(null);
      setJudging(false);
      judgeResumeInFlightRef.current = false;
    }
  };

  // 按AI结果发放金币
  const handleRewardByResult = async () => {
    if (!judgeResult) return;
    // 老师自己示范回答时不发金币：奖励是给学生的，
    // 而且这个模式下压根没有 student_id 可以发给。
    const rs = resultStudent(judgeResult);
    if (!rs || rs.isTeacher) {
      message.info(rs?.isTeacher ? '教师示范回答不发金币，可在右侧学生列表里选人后再发' : '还没有确定答题人，无法发放奖励');
      return;
    }
    const coins = Math.max(0, Math.round((judgeResult.score / 100) * perQValue));
    if (coins <= 0) {
      message.warning('按当前得分计算发放为0，可调大本题分值后再发');
      return;
    }
    try {
      await classroomQuizAPI.rewardStudent(quiz.id, {
        student_ids: [judgeResult.student.id],
        reward_type: 'gold',
        reward_value: coins,
        reward_name: '课堂答题奖励',
        question_id: currentQuestion?.id,
        reason: `第${judgeResult.questionIndex + 1}题AI评判${judgeResult.score}分`,
      });
      message.success(`已向 ${answererName(judgeResult.student)} 发放 ${coins} 金币`);
      setJudgeResult((r: any) => ({ ...r, coins }));
      // 把金币数额回填到该条答题记录
      if (judgeResult.answerId) {
        try { await classroomQuizAPI.updateAnswerReward(judgeResult.answerId, coins); } catch (e) { /* 忽略 */ }
      }
      loadAnswers();
      onRewarded();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    }
  };

  // 批量发放奖励（奖励栏，发给所有勾选学生）
  const handleReward = async () => {
    if (selectedIds.size === 0) { message.warning('请先勾选学生（学生卡片上的勾选框）'); return; }
    if (rewardValue === null || rewardValue === undefined || rewardValue <= 0) {
      message.warning(rewardType === 'item' || rewardType === 'equipment' ? '请选择物品/装备' : '请填写奖励数值');
      return;
    }
    setRewarding(true);
    try {
      await classroomQuizAPI.rewardStudent(quiz.id, {
        student_ids: Array.from(selectedIds),
        reward_type: rewardType,
        reward_value: rewardValue,
        reward_name: rewardName || undefined,
        question_id: currentQuestion?.id || undefined,
        reason: rewardReason || undefined,
      });
      message.success(`已向 ${selectedIds.size} 名学生发放奖励`);
      setSelectedIds(new Set());
      onRewarded();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    } finally {
      setRewarding(false);
    }
  };

  const renderStudentCard = (s: any) => {
    const selected = selectedIds.has(s.id);
    const isAnswerer = answerer?.id === s.id;
    // 被随机点名抽中过的人：即使名单后来被折叠，也要能一眼认出来。
    // 用金色描边 + 「点名」角标，和「当前答题人」的绿框区分开：
    // 前者是「刚被抽到」，后者是「现在正由他回答」。
    const wasPicked = pickedStudent?.id === s.id;
    return (
      <div
        key={s.id}
        ref={(el) => { cardRefs.current[s.id] = el; }}
        onClick={() => {
   setAnswerer(s); setAnswerMode('student'); setPickedStudent(s);
  setJudgeResult(null); setAnswerText('');
          // 若是「先点了选项、弹窗里选我自己选学生」走过来的，这里接着判
          discardPendingPick();
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          borderRadius: 8, cursor: 'pointer', marginBottom: 6,
          background: isAnswerer ? '#113a1f' : wasPicked ? '#3a2f0b' : selected ? '#15325b' : '#1f1f1f',
          border: isAnswerer ? '2px solid #52c41a' : wasPicked ? '2px solid #faad14' : selected ? '2px solid #1890ff' : '1px solid #333',
        }}
        title="点击设为答题人"
      >
        {wasPicked && !isAnswerer && (
          <Tag color="gold" style={{ marginRight: 0, fontSize: 11, lineHeight: '16px' }}>点名</Tag>
        )}
        <Checkbox
          checked={selected}
          onChange={() => toggleRewardSelect(s.id)}
          onClick={(e) => e.stopPropagation()}
        />
        {s.pet_id ? (
          <img src={getPetThumbUrl(s)} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain' }} />
        ) : (
          <Avatar icon={<UserSwitchOutlined />} size={32} style={{ background: '#333' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.real_name || s.username}
            {isAnswerer && <Tag color="green" style={{ marginLeft: 6 }}>答题中</Tag>}
          </div>
          {s.pet_name && (
            <div style={{ color: '#888', fontSize: 11 }}>
              {s.pet_name} Lv.{s.pet_level}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ===== 主区内容 =====
  const mainArea = () => {
    if (judgeResult) {
      const coins = Math.max(0, Math.round((judgeResult.score / 100) * perQValue));
      const resultText = `${resultStudent(judgeResult)?.isTeacher ? '' : answererName(judgeResult.student) + '同学，'}${judgeResult.is_correct ? '回答正确' : '回答不够准确'}，得分${judgeResult.score}分。${judgeResult.comment}${judgeResult.correct_answer ? ` 正确答案是：${judgeResult.correct_answer}。` : ''}`;
      return (
        <div style={{ textAlign: 'center', width: '100%', padding: '0 24px' }}>
          <div style={{ color: '#aaa', fontSize: 'clamp(16px, 1.8vw, 24px)', marginBottom: 8 }}>
            第 {judgeResult.questionIndex + 1} 题 · {resultStudent(judgeResult)?.isTeacher ? '教师示范' : '答题人'}
          </div>
          <div style={{ color: '#fff', fontSize: `calc(clamp(30px, 4vw, 56px) * ${fontScale})`, fontWeight: 'bold' }}>
            {answererName(judgeResult.student)}
          </div>
          <div style={{ margin: '20px 0' }}>
            {judgeResult.is_correct
              ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 'clamp(48px, 5vw, 80px)' }} />
              : <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 'clamp(48px, 5vw, 80px)' }} />}
            <span style={{ color: judgeResult.is_correct ? '#52c41a' : '#ff4d4f', fontSize: `calc(clamp(56px, 8vw, 110px) * ${fontScale})`, fontWeight: 'bold', marginLeft: 20 }}>
              {judgeResult.score}分
            </span>
          </div>
          <div style={{ color: '#ddd', fontSize: `calc(clamp(18px, 2.4vw, 32px) * ${fontScale})`, maxWidth: 900, margin: '0 auto' }}>
              {/* AI 判分返回的 comment 本身就是讲解，不再单独让老师点一次「让 AI 讲解」——
                  判分和讲解本来就是同一轮 AI 输出里一起回来的。 */}
              {judgeResult.comment}
            </div>
          {judgeResult.correct_answer && (
            <div style={{
              color: '#bae637', fontSize: `calc(clamp(18px, 2.2vw, 30px) * ${fontScale})`, maxWidth: 900, margin: '16px auto 0',
              background: '#1c2b12', border: '1px solid #3a5318', borderRadius: 8, padding: '10px 16px'
            }}>
              正确答案：{judgeResult.correct_answer}
            </div>
          )}
          <div style={{ color: '#888', fontSize: 'clamp(14px, 1.6vw, 20px)', marginTop: 12 }}>回答：{judgeResult.answer}</div>
          {/* 接回上次判分的结果：先不落库，等老师确认再记进答题记录 */}
          {judgeResult.pendingSave && (
            <div style={{ marginTop: 16 }}>
              <Alert
                type="warning"
                showIcon
                message="这是接回的上一次判分结果"
                description={`第 ${judgeResult.questionIndex + 1} 题 · ${answererName(judgeResult.student)}的作答。确认无误后再保存到答题记录，避免记错人。`}
              />
            </div>
          )}
          <Space style={{ marginTop: 24 }} wrap>
            {judgeResult.pendingSave && (
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={savePendingJudge}>
                保存这个判分结果
              </Button>
            )}
            {judgeResult.coins > 0 ? (
              <Tag color="gold" style={{ fontSize: 16, padding: '4px 12px' }}>已发放 {judgeResult.coins} 金币</Tag>
            ) : (
              <Button type="primary" icon={<GiftOutlined />} onClick={handleRewardByResult}>
                按结果发放 {coins} 金币（本题值{perQValue}）
              </Button>
            )}
            {!speaking ? (
              <Button icon={<SoundOutlined />} onClick={() => speakText(resultText)}>朗读结果</Button>
            ) : paused ? (
              <Button icon={<PlayCircleOutlined />} onClick={resumeSpeech}>继续朗读</Button>
            ) : (
              <Button icon={<PauseCircleOutlined />} onClick={pauseSpeech}>暂停朗读</Button>
            )}
            {speaking && <Button icon={<StopOutlined />} onClick={stopSpeech}>停止</Button>}
                <Button onClick={() => { stopSpeech(); setJudgeResult(null); setAnswerText(''); setPickedKeys([]); setLocalResult(null); }}>继续答题</Button>
          </Space>
        </div>
      );
    }
    if (randomState) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontSize: 'clamp(16px, 2vw, 26px)', marginBottom: 16 }}>
            {randomState.rolling ? '随机点名中...' : '被点到的同学是'}
          </div>
          <div style={{ color: randomState.rolling ? '#999' : '#1890ff', fontSize: `calc(clamp(56px, 10vw, 140px) * ${fontScale})`, fontWeight: 'bold' }}>
            {randomState.name || '...'}
          </div>
          {!randomState.rolling && (
            <Space style={{ marginTop: 24 }}>
              <Button onClick={startRandomPick} icon={<ReloadOutlined />}>再来一次</Button>
              <Button onClick={() => { setRandomState(null); }}>开始答题</Button>
            </Space>
          )}
        </div>
      );
    }
    if (buzzLeft !== null && buzzLeft > 0) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#52c41a', fontSize: 22, marginBottom: 8 }}>抢答计时中！</div>
          <div style={{ color: '#52c41a', fontSize: 150, fontWeight: 'bold', lineHeight: 1 }}>{buzzLeft}</div>
          <Button
            danger
            size="large"
            icon={<StopOutlined />}
            style={{ marginTop: 24 }}
            onClick={() => setBuzzLeft(null)}
          >
            提前结束（有人举手了）
          </Button>
        </div>
      );
    }
    if (buzzLeft === 0) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 110, fontWeight: 'bold' }}>时间到！</div>
          <Space style={{ marginTop: 24 }}>
            <Button size="large" onClick={() => setBuzzLeft(null)}>返回题目</Button>
            <Button size="large" type="primary" danger icon={<ThunderboltOutlined />} onClick={() => setBuzzLeft(buzzTotal)}>
              再来一轮
            </Button>
          </Space>
        </div>
      );
    }
    return (
      // 题目改为左对齐：题干常有二三行，居中时每行都长短不齐，学生视线要来回跳，
      // 投影到大屏上尤其明显。左对齐后第一行起始位置固定，读起来更顺。
      <div style={{ textAlign: 'left', width: '100%' }}>
        <div style={{ color: '#666', fontSize: 'clamp(16px, 1.8vw, 24px)', marginBottom: 12 }}>
          第 {index + 1} / {questions.length} 题
          {autoPlay && <Tag color="blue" style={{ marginLeft: 12 }}>自动播放中</Tag>}
          {answerer && <Tag color="green" style={{ marginLeft: 12 }}>答题人：{answererName(answerer)}</Tag>}
        </div>
        <div style={{ color: '#fff', fontSize: `calc(clamp(30px, 4.5vw, 64px) * ${fontScale})`, fontWeight: 500, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {/* 题干里内嵌了选项时只显示 stem，选项交给下方按钮呈现，不重复显示两遍 */}
          {localJudgeable ? (localStem || currentQuestion?.question_text) : (currentQuestion?.question_text || '暂无题目')}
        </div>

        {/* 题目附带的 HTML 课件：先让学生看课件、操作思考，再回到题目作答 */}
        {currentQuestion?.courseware_html && (
          <div style={{ marginTop: 16 }}>
            <Button
              type={showCourseware ? 'default' : 'primary'}
              icon={<FileTextOutlined />}
              onClick={() => setShowCourseware((v) => !v)}
            >
              {showCourseware ? '收起课件' : '展示课件（学生先看再答）'}
            </Button>
          </div>
        )}
        {showCourseware && currentQuestion?.courseware_html && (
          <div style={{
            marginTop: 12, width: '92%', height: '52vh', background: '#fff',
            borderRadius: 8, overflow: 'hidden', border: '1px solid #333',
          }}>
            <iframe
              title="question-courseware"
              srcDoc={currentQuestion.courseware_html}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        )}

        {/* 参考答案：只给老师看，点一下才展开 */}
        {currentQuestion?.answer_text && (
          <div style={{ marginTop: 12 }}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setShowAnswer((v) => !v)}>
              {showAnswer ? '隐藏参考答案' : '参考答案'}
            </Button>
            {showAnswer && (
              <div style={{ color: '#52c41a', fontSize: 20, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {currentQuestion.answer_text}
              </div>
            )}
          </div>
        )}

        {/* 朗读控制 */}
        <Space style={{ marginTop: 16 }} wrap>
          {!speaking ? (
            <Button icon={<SoundOutlined />} onClick={() => speakText()}>朗读题目</Button>
          ) : paused ? (
            <Button icon={<PlayCircleOutlined />} onClick={resumeSpeech}>继续朗读</Button>
          ) : (
            <Button icon={<PauseCircleOutlined />} onClick={pauseSpeech}>暂停朗读</Button>
          )}
          {speaking && <Button icon={<StopOutlined />} onClick={stopSpeech}>停止</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => speakText()}>重读</Button>
          {voices.length > 0 && (
            <Select
              size="small"
              style={{ width: 260 }}
              value={voiceURI || voices.find(v => /yunxi|云希/i.test(v.name))?.voiceURI || voices.find(v => /^zh/i.test(v.lang))?.voiceURI || voices[0]?.voiceURI}
              onChange={(v) => { setVoiceURI(v); localStorage.setItem('cls_tts_voice', v); }}
              options={voices.map(v => ({ value: v.voiceURI, label: `${v.name}（${v.lang}）` }))}
              placeholder="朗读声音"
            />
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={loadVoices} title="重新加载系统语音列表">刷新声音</Button>
          <span style={{ color: '#666', fontSize: 12 }}>共{voices.length}个</span>
          {voices.length === 0 && <span style={{ color: '#666', fontSize: 12 }}>未检测到语音，请点刷新声音</span>}
        </Space>
      </div>
    );
  };

  // 汇总数据（基于本课堂全部持久化记录）
  const summaryByStudent = useMemo(() => {
    const map = new Map<number, { name: string; count: number; correct: number; totalScore: number; coins: number }>();
    for (const a of records) {
      const key = a.student_id;
      const item = map.get(key) || { name: a.student_name, count: 0, correct: 0, totalScore: 0, coins: 0 };
      item.count++;
      if (a.is_correct) item.correct++;
      item.totalScore += a.score || 0;
      item.coins += a.coin_rewarded || 0;
      map.set(key, item);
    }
    return Array.from(map.values());
  }, [records]);

  return (
    <div className="cc-dark" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#141414', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {/* 深色主题下修正 antd 输入控件配色 */}
      <style>{`
        .cc-dark .ant-input-number { background: #1f1f1f; border-color: #444; }
        .cc-dark .ant-input-number-group-addon { background: #2a2a2a; color: #ccc; border-color: #444; }
        .cc-dark .ant-input-number-input { color: #fff; }
        .cc-dark .ant-input-affix-wrapper { background: #1f1f1f; border-color: #444; }
        .cc-dark .ant-input, .cc-dark input.ant-input { background: transparent; color: #fff; }
        .cc-dark input::placeholder { color: #666; }
        .cc-dark textarea::placeholder { color: #666; }
        .cc-dark .ant-select-selector { background: #1f1f1f !important; border-color: #444 !important; }
        .cc-dark .ant-select-selection-item { color: #eee; }
        .cc-dark .ant-select-arrow { color: #999; }
        .cc-dark .ant-btn-primary:disabled, .cc-dark .ant-btn-primary.ant-btn-disabled {
          background: #3a3a3a !important; color: #fff !important; border-color: #555 !important;
        }
        .cc-dark .ant-slider-track { background: #1890ff; }
        .cc-dark .ant-slider-rail { background: #333; }
      `}</style>

      {/* 顶栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #333' }}>
        <div style={{ color: '#ccc', fontSize: 15 }}>
          <span style={{ color: '#fff', fontWeight: 500 }}>{quiz.title}</span>
          <span style={{ marginLeft: 12 }}>{quiz.class_name || ''}</span>
          <span style={{ marginLeft: 12, color: '#888' }}>课堂控制台（←/→ 翻题，Esc 退出）</span>
        </div>
        <Space>
          {/* 当前答题人：名单折叠时也一直挂在这里。
              折叠只是把名单收起来，绝不能把「现在该谁回答」一起收掉——
              那是老师上课时最需要随时瞄一眼的信息。 */}
          {effectiveAnswerer && (
                   <Tag
             color={answerMode === 'teacher' ? 'blue' : 'green'}
                style={{ fontSize: 13, padding: '3px 10px', marginInlineEnd: 0 }}
               >
                      <UserSwitchOutlined style={{ marginRight: 4 }} />
                      {answerMode === 'teacher' ? '教师示范' : `答题人：${answererName(answerer)}`}
                    </Tag>
                  )}
          <Button
            icon={studentPanelOpen ? <RightOutlined /> : <UserSwitchOutlined />}
            onClick={() => setStudentPanelOpen((v) => !v)}
          >
            {studentPanelOpen ? '收起名单' : `学生名单（${students.length}）`}
          </Button>
          <Button icon={<BarChartOutlined />} onClick={() => setSummaryOpen(true)}>课堂总结（{records.length}条）</Button>
          <Button icon={<CloseOutlined />} ghost onClick={onClose}>退出控制台</Button>
        </Space>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：题目 + 答题 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0,
            WebkitOverflowScrolling: 'touch', padding: '12px 16px'
          }}>
            <div style={{ margin: 'auto', width: '100%' }}>
              {mainArea()}
            </div>

            {/* 答题录入栏（展示结果时隐藏） */}
            {!judgeResult && !randomState && buzzLeft === null && (
              <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginTop: 10 }}>
                {/* 客观题：直接点选项，本地秒判；不需要语音、不需要 AI */}
                {localJudgeable && (
                   <div style={{ minHeight: ANSWER_AREA_MIN_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                        <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                    点选项直接判对错
                       {answerMode === 'teacher'
                       ? <span style={{ color: '#1890ff', marginLeft: 8 }}>教师示范（不记入学生答题）</span>
                           : answerer
                        ? <span style={{ color: '#52c41a', marginLeft: 8 }}>答题人：{answererName(answerer)}</span>
                        : <a style={{ color: '#faad14', marginLeft: 8 }} onClick={() => setPickerOpen(true)}>
                        未指定答题人，点这里指定（不指定也能判，只是不入库）
                           </a>}
                      {currentQuestion?.question_type === 'choice_multi' && (
                        <span style={{ marginLeft: 8 }}>多选题，可选多个</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {localOptions.map((o) => {
                        const picked = pickedKeys.includes(o.key);
                        const isAnswer = normalizeAnswer(currentQuestion?.answer_text) === o.key;
                        // 判错时把正确答案标出来：本地判分只给对错，「为什么」靠讲解
                        const showAnswer = !!localResult && !localResult.isCorrect && isAnswer;
                        return (
                          <Button
                            key={o.key}
                            size="large"
                            onClick={() => pickOption(o.key)}
                            style={{
                              minWidth: 200, height: 'auto', padding: '12px 16px', whiteSpace: 'normal', textAlign: 'left',
                              fontSize: 'clamp(15px, 1.4vw, 20px)',
                              borderColor: picked ? '#1890ff' : undefined,
                              background: picked ? '#e6f7ff' : undefined,
                              color: showAnswer ? '#52c41a' : undefined,
                              fontWeight: showAnswer ? 700 : undefined,
                            }}
                          >
                            <span style={{ marginRight: 8, fontWeight: 700 }}>{o.key}</span>
                            {o.text}
                            {showAnswer && <span style={{ marginLeft: 8 }}>← 正确答案</span>}
                          </Button>
                        );
                      })}
                    </div>
                    {currentQuestion?.question_type === 'choice_multi' && (
                      <div style={{ marginTop: 10 }}>
                        <Button
                          type="primary"
                          disabled={!pickedKeys.length || !!localResult}
                          onClick={() => applyLocalJudge(pickedKeys)}
                        >
                          提交答案{pickedKeys.length ? `（${pickedKeys.sort().join('')}）` : ''}
                        </Button>
                        {localResult && (
                          <Button style={{ marginLeft: 10 }} onClick={() => { setPickedKeys([]); setLocalResult(null); }}>
                            重选
                          </Button>
                        )}
                      </div>
                    )}
                    {/* 本地判分给出的对错反馈 */}
                    {localResult && (
                      <div style={{
                        marginTop: 10, padding: '10px 12px', borderRadius: 8,
                        background: localResult.isCorrect ? '#f6ffed' : '#fff1f0',
                        border: `1px solid ${localResult.isCorrect ? '#b7eb8f' : '#ffa39e'}`,
                      }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: localResult.isCorrect ? '#389e0d' : '#cf1322' }}>
                          {localResult.isCorrect ? `回答正确（${localResult.studentAnswer}）` : `回答错误，正确答案是 ${localResult.correctAnswer}`}
                        </div>
                        {!localResult.isCorrect && currentQuestion?.explanation && (
                          <div style={{ color: '#666', fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
                            讲解：{currentQuestion.explanation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 主观题 / 缺标准答案的题：语音或手动录入 + AI 判分（原流程） */}
                <div style={{
                        display: localJudgeable ? 'none' : 'flex',
                        alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
                     minHeight: ANSWER_AREA_MIN_HEIGHT, alignContent: 'flex-end',
                      }}>
                  <div>
                    <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>本题分值（金币）</div>
                    <InputNumber min={1} max={1000} value={perQValue} onChange={(v) => setPerQValue(v || 10)} style={{ width: 110 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>
                      学生回答（点麦克风录入，或手动输入）
                      {answerer && <span style={{ color: '#52c41a', marginLeft: 8 }}>答题人：{answererName(answerer)}</span>}
                    </div>
                    <Input
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="学生口头回答的内容..."
                      suffix={
                        <Button
                          size="small"
                          type={listening ? 'primary' : 'default'}
                          danger={listening}
                          icon={<AudioOutlined />}
                          onClick={listening ? stopListening : startListening}
                        >
                          {listening ? '停止录音' : '语音录入'}
                        </Button>
                      }
                    />
                  </div>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={judging}
                    onClick={handleJudge}
                  >
                    {judging
                      ? `AI评判中... 已等待${judgeSeconds}秒`
                      : readPendingQuizJudge(user?.id) ? '查看上次判分结果' : '提交AI评判'}
                  </Button>
                </div>
              </div>
            )}

            {/* 「问 AI」答疑：判分本地已经秒判完了，AI 负责把「为什么」讲清楚。
                老师手工选定学生答案，再补一句学生的疑问即可，不额外占生成次数。 */}
            {explainOpen && (
              <div style={{ marginTop: 10, padding: 12, background: '#20242e', borderRadius: 8, border: '1px solid #3a4152' }}>
                <div style={{ color: '#ccc', fontSize: 13, marginBottom: 8 }}>
                  追问 AI：把题目、学生的答案和疑问交给 AI，继续往下讲
                  {localResult && <span style={{ color: '#888', marginLeft: 8 }}>已选答案：{localResult.studentAnswer}</span>}
                </div>
                <Input
                  value={explainQuestion}
                  onChange={(e) => setExplainQuestion(e.target.value)}
                  placeholder="学生的疑问，例如：为什么选B 不选 C？"
                  onPressEnter={handleExplain}
                />
                <Space style={{ marginTop: 8 }}>
                  <Button type="primary" icon={<ThunderboltOutlined />} loading={explaining} onClick={handleExplain}>
                    {explaining ? 'AI讲解中...' : '让 AI 讲解'}
                  </Button>
                  <Button onClick={() => { setExplainOpen(false); setExplainResult(null); }}>收起</Button>
                </Space>
                {explaining && explainProgress && (
                  <div style={{ marginTop: 8 }}>
                    <Progress percent={explainProgress.percent} size="small" status="active" />
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{explainProgress.current}</div>
                  </div>
                )}
                {explainResult && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: '#1c2b12', border: '1px solid #3a5318', borderRadius: 8 }}>
                    {explainResult.key_point && (
                      <div style={{ color: '#bae637', fontSize: 13, marginBottom: 4, fontWeight: 600 }}>
                        关键点：{explainResult.key_point}
                      </div>
                    )}
                    <div style={{ color: '#ddd', fontSize: 14, lineHeight: 1.7 }}>{explainResult.explanation}</div>
                    {!speaking && explainResult.explanation && (
                      <Button size="small" icon={<SoundOutlined />} style={{ marginTop: 8 }} onClick={() => speakText(explainResult.explanation)}>
                        朗读讲解
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* 「问 AI」只在有东西可追问时才出现：
                ① AI 判分后（comment本身就是讲解，学生看完可能还有疑问）
                ② 题目自带 explanation、本地秒判已经展示过讲解
                没有讲解可问的时候不摆这个按钮，免得又造一个和「提交AI评判」
                重复的入口——这正是之前那版设计的问题。*/}
            {!explainOpen && !randomState && buzzLeft === null && currentQuestion
              && (judgeResult?.comment || currentQuestion.explanation) && (
              <div style={{ marginTop: 8 }}>
                <Button size="small" icon={<ThunderboltOutlined />} onClick={() => setExplainOpen(true)}>
                  问 AI（把疑问交给 AI 继续讲）
                </Button>
              </div>
            )}

            {/* 判分进度：让老师看得见在做什么，而不是一个停不下来的转圈 */}
            {!localJudgeable && judging && judgeProgress && (
              <div style={{ marginTop: 8 }}>
                <Progress percent={judgeProgress.percent} size="small" status="active" />
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{judgeProgress.current}</div>
              </div>
            )}
            {!!localJudgeable && explaining && explainProgress && (
              <div style={{ marginTop: 8 }}>
                <Progress percent={explainProgress.percent} size="small" status="active" />
              </div>
            )}
          </div>

          {/* 题目控制条 */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 16px' }}>
            <Button icon={<LeftOutlined />} onClick={() => setIndex(i => Math.max(i - 1, 0))}>上一题</Button>
            <Button onClick={() => setIndex(i => Math.min(i + 1, questions.length - 1))}>下一题 <RightOutlined /></Button>
            <span style={{ color: '#555' }}>|</span>
            <Checkbox checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} style={{ color: '#aaa' }}>自动播放</Checkbox>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>字号</span>
    {/* 用数字输入框而不是滑块：滑块只能「大概」拖到某个位置，
       而投屏字号这事需要能精确落到某个倍数（比如 1.4 倍）并记住。
       加减号常显（antd 默认 hover 才出现，这里强制显示），
        课堂上不必精确瞄准、点一下就调一档更省事。*/}
    <Button
size="small"
                  onClick={() => applyFontScale(fontScale - FONT_SCALE_STEP)}
 disabled={fontScale <= FONT_SCALE_MIN}
        aria-label="减小字号"
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>−</span>
           </Button>
      <InputNumber
     min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
   step={FONT_SCALE_STEP}
   value={fontScale}
 onChange={(v) => applyFontScale(Number(v))}
      style={{ width: 78 }}
        addonAfter="倍"
        controls={false}
   />
   <Button
  size="small"
   onClick={() => applyFontScale(fontScale + FONT_SCALE_STEP)}
disabled={fontScale >= FONT_SCALE_MAX}
     aria-label="增大字号"
      >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
   </Button>
     <span style={{ color: '#666', fontSize: 12, minWidth: 38 }}>
       {Math.round(fontScale * 100)}%
  </span>
 </span>
            <span>
              <InputNumber min={5} max={300} value={autoSeconds} onChange={(v) => setAutoSeconds(v || 30)} style={{ width: 90 }} />
              <span style={{ color: '#aaa', marginLeft: 4, fontSize: 12 }}>秒/题</span>
            </span>
            <span>
              <InputNumber min={5} max={300} value={buzzTotal} onChange={(v) => setBuzzTotal(v || 30)} style={{ width: 90 }} />
              <span style={{ color: '#aaa', marginLeft: 4, fontSize: 12 }}>秒抢答</span>
            </span>
            <Button type="primary" danger icon={<ThunderboltOutlined />} onClick={() => { setAutoPlay(false); setRandomState(null); setJudgeResult(null); setBuzzLeft(buzzTotal); }}>
              开始抢答
            </Button>
            <Button icon={<UserSwitchOutlined />} onClick={startRandomPick}>随机点名</Button>
          </div>
        </div>

        {/* 右侧：学生面板 + 奖励栏。
            折叠时不整块卸载，而是收成一条窄栏——因为「当前答题人」和
            「刚被点名的人」这两条信息不能跟着一起消失。 */}
        {studentPanelOpen ? (
        <div style={{ width: 400, borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 搜索 + 小键盘 */}
          <div style={{ padding: 12, background: '#1a1f29', borderBottom: '1px solid #2a3040' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                placeholder="姓名/拼音首字母/用户名"
                prefix={<SearchOutlined style={{ color: '#999' }} />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                allowClear
              />
              <Button icon={<DeleteOutlined />} onClick={() => setQuery('')} title="清空搜索" />
            </div>
            {/* 屏幕小键盘（QWERTY布局） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {KEYPAD_ROWS.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', gap: 4 }}>
                  {row.map(k => (
                    <Button key={k} size="small" style={{ flex: 1 }} onClick={() => setQuery(q => q + k)}>
                      {k.toUpperCase()}
                    </Button>
                  ))}
                  {ri === 2 && (
                    <Button size="small" style={{ flex: 2 }} icon={<DeleteOutlined />} onClick={() => setQuery(q => q.slice(0, -1))} title="退格" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: '#888', fontSize: 12 }}>
              <span>已选 {selectedIds.size} 人 / 共 {students.length} 人（点卡片=定答题人）</span>
              <span>
                <a style={{ color: '#1890ff' }} onClick={selectAllFiltered}>全选</a>
                <span style={{ margin: '0 6px' }}>|</span>
                <a style={{ color: '#1890ff' }} onClick={clearSelection}>清空</a>
              </span>
            </div>
          </div>

          {/* 学生列表 */}
          <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#101216' }}>
            <Spin spinning={studentsLoading}>
              {filteredStudents.length > 0 ? (
                filteredStudents.map(renderStudentCard)
              ) : (
                <Empty description={students.length === 0 ? '暂无学生' : '没有匹配的学生'} />
              )}
            </Spin>
          </div>

          {/* 奖励栏（学生列表下方） */}
          <div style={{ borderTop: '1px solid #2a3040', padding: 12, background: '#20242e' }}>
            <div style={{ color: '#ccc', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
              <GiftOutlined style={{ marginRight: 6 }} />发放奖励
              {selectedIds.size > 0 && <Tag color="blue" style={{ marginLeft: 8 }}>已选{selectedIds.size}人</Tag>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Select
                value={rewardType}
                style={{ flex: 1 }}
                onChange={setRewardType}
                options={Object.entries(REWARD_TYPES).map(([k, v]) => ({ value: k, label: v }))}
              />
              {rewardType === 'item' || rewardType === 'equipment' ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ flex: 2 }}
                  placeholder="选择物品/装备"
                  loading={rewardType === 'item' ? itemsLoading : equipmentsLoading}
                  notFoundContent={(rewardType === 'item' ? itemsLoading : equipmentsLoading) ? '加载中...' : '没有可发放的物品/装备'}
                  value={rewardValue ?? undefined}
                  options={rewardType === 'item'
                    ? items.map((it: any) => ({ value: it.id, label: `${it.name}（${it.price ?? '-'}金币）`, name: it.name }))
                    : equipments.map((eq: any) => ({ value: eq.id, label: `${eq.name}（${rarityLabel(eq.rarity)}）`, name: eq.name }))}
                  onSelect={(_, opt: any) => {
                    setRewardValue(opt.value);
                    if (!nameTouched) setRewardName(opt.name);
                  }}
                />
              ) : (
                <>
                  <InputNumber min={1} max={999999} value={rewardValue} onChange={(v) => setRewardValue(v)} style={{ width: 110 }} />
                  <Space size={4}>
                    {QUICK_AMOUNTS.map(n => (
                      <Button key={n} size="small" onClick={() => setRewardValue(n)}>{n}</Button>
                    ))}
                  </Space>
                </>
              )}
            </div>
            <Input
              value={rewardName}
              onChange={(e) => { setRewardName(e.target.value); setNameTouched(true); }}
              placeholder="奖励名称（自动填，可改）"
              maxLength={50}
              style={{ marginBottom: 8 }}
            />
            <Input
              value={rewardReason}
              onChange={(e) => { setRewardReason(e.target.value); setReasonTouched(true); }}
              placeholder="奖励原因（自动填，可改）"
              maxLength={100}
              style={{ marginBottom: 8 }}
            />
            <Button
              type="primary"
              icon={<GiftOutlined />}
              loading={rewarding}
              disabled={selectedIds.size === 0}
              onClick={handleReward}
              block
            >
              发奖励给已选的 {selectedIds.size} 名学生
            </Button>
          </div>
        </div>
        ) : (
          /* 折叠态：只留一条窄栏。
             保留它而不是整块卸载，是因为「现在该谁回答」「刚被点名的是谁」
             这两条信息在名单折叠时仍然必须一眼可见——老师上课时最常瞄的就是它。 */
          <div style={{
            width: 56, borderLeft: '1px solid #333', background: '#1a1f29',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '12px 0', gap: 12,
          }}>
            <Button
              type="text"
              icon={<UserSwitchOutlined style={{ color: '#ccc', fontSize: 18 }} />}
              onClick={() => setStudentPanelOpen(true)}
              title="展开学生名单"
            />
            <span style={{ color: '#666', fontSize: 12, writingMode: 'vertical-rl', letterSpacing: 2 }}>
              学生名单 {students.length}
            </span>
            {/* 折叠时也要能看到答题人：竖排显示名字，比纯图标更明确 */}
            {effectiveAnswerer && (
                          <Tooltip title={`当前答题人：${answererName(effectiveAnswerer)}`} placement="left">
                <div style={{
                  writingMode: 'vertical-rl', color: '#52c41a', fontSize: 14,
                  background: '#113a1f', border: '1px solid #52c41a',
                  borderRadius: 6, padding: '8px 4px', maxHeight: 220, overflow: 'hidden',
                }}>
                  {answererName(effectiveAnswerer)}
                       </div>
              </Tooltip>
            )}
            {/* 被点名的人若不是当前答题人，再单独标一个金色角标 */}
            {pickedStudent && pickedStudent.id !== answerer?.id && (
              <Tooltip title={`刚被点名：${pickedStudent.real_name || pickedStudent.username}`} placement="left">
                <div style={{
                  writingMode: 'vertical-rl', color: '#faad14', fontSize: 13,
                  background: '#3a2f0b', border: '1px solid #faad14',
                  borderRadius: 6, padding: '8px 4px', maxHeight: 180, overflow: 'hidden',
                }}>
                  点名 {pickedStudent.real_name || pickedStudent.username}
                </div>
              </Tooltip>
            )}
            {selectedIds.size > 0 && (
              <Tooltip title={`已勾选 ${selectedIds.size} 人待发奖`} placement="left">
                <div style={{
                  color: '#1890ff', fontSize: 12, background: '#15325b',
                  border: '1px solid #1890ff', borderRadius: 6, padding: '6px 3px',
                }}>
                  {selectedIds.size}
                </div>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* 未定答题人时的三选一。
   antd 的 Modal.confirm 只有 ok/cancel 两个按钮，放不下「教师自己回答」，
   所以这里用自定义 Modal。*/}
      <Modal
title="谁在回答这道题？"
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
      footer={null}
        width={560}
        zIndex={3100}
      >
     <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
    <Button
   block
        size="large"
   icon={<ThunderboltOutlined />}
      onClick={() => { setPickerOpen(false); setStudentPanelOpen(true); startRandomPick(); }}
        >
        随机点名（抽中后由该学生现场回答）
    </Button>
      <Button
          block
    size="large"
     onClick={() => { setPickerOpen(false); setStudentPanelOpen(true); }}
        >
        我自己选学生（点选后由该学生重新作答）
     </Button>
          <Button
            block
  size="large"
 type="primary"
    icon={<UserSwitchOutlined />}
       onClick={() => {
        setPickerOpen(false);
     setAnswerMode('teacher');
             setAnswerer(null);
             // 只有「教师自己回答」才把之前点的那个选项提交上去：
        // 那本来就是老师自己的答案；被指定的学生要自己重新回答。
        const key = pendingPickRef.current;
        pendingPickRef.current = null;
        if (key) {
          setPickedKeys([key]);
 applyLocalJudge([key], TEACHER_ANSWERER);
        }
           }}
          >
     教师自己回答（不记入学生答题）
     </Button>
      <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
   选定之后：若刚才已经点了某个选项，那个选项会被清空——被指定的学生要自己重新作答，
          只有选「教师自己回答」才会把刚才点的选项直接提交上去。
          </div>
        </div>
      </Modal>

      {/* 课堂总结 */}
      <Modal
        title={`课堂总结：${quiz.title}`}
        open={summaryOpen}
        zIndex={3000}
        onCancel={() => setSummaryOpen(false)}
        footer={<Button type="primary" onClick={() => setSummaryOpen(false)}>关闭</Button>}
        width={760}
      >
        {records.length === 0 ? (
          <Empty description="本课堂还没有答题记录" />
        ) : (
          <>
            <Table
              dataSource={records.map((a, i) => ({ ...a, key: i }))}
              columns={[
                { title: '题号', width: 70, render: (_: any, r: any) => `第${r.questionIndex + 1}题` },
                { title: '答题人', dataIndex: 'student_name', width: 90 },
                { title: '回答', dataIndex: 'answer_text', ellipsis: true },
                { title: '判定', width: 80, render: (_: any, r: any) => r.is_correct ? <Tag color="green">正确</Tag> : <Tag color="red">错误</Tag> },
                { title: '得分', width: 70, dataIndex: 'score', render: (v: number) => `${v ?? 0}分` },
                { title: '金币', width: 70, dataIndex: 'coin_rewarded', render: (v: number) => v > 0 ? `+${v}` : '-' },
              ]}
              pagination={{ pageSize: 8 }}
              size="small"
              style={{ marginBottom: 16 }}
            />
            <Table
              dataSource={summaryByStudent.map((s, i) => ({ ...s, key: i }))}
              columns={[
                { title: '学生', dataIndex: 'name' },
                { title: '答题次数', dataIndex: 'count', width: 100 },
                { title: '答对', dataIndex: 'correct', width: 80 },
                { title: '平均得分', width: 100, render: (_: any, r: any) => r.count > 0 ? `${Math.round(r.totalScore / r.count)}分` : '-' },
                { title: '获得金币', width: 100, render: (_: any, r: any) => r.coins > 0 ? `+${r.coins}` : '-' },
              ]}
              pagination={false}
              size="small"
              title={() => '按学生汇总'}
            />
            <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              答题记录已保存到各学生的课堂答题档案中；金币发放以实际发放记录为准。
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ClassroomConsole;
