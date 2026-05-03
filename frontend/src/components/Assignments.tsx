import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Modal, Form, Input, DatePicker, Select, InputNumber, message, Space, Radio, Checkbox, Progress, Card, Alert, Upload, Image, Divider, Empty, Statistic, Row, Col, Tabs, Badge, Popconfirm } from 'antd';
import { assignmentAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, BookOutlined, EyeOutlined, BarChartOutlined, RobotOutlined, LoadingOutlined, CameraOutlined, StopOutlined, EditOutlined } from '@ant-design/icons';
import CelebrationAnimation from './CelebrationAnimation';

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
  question_count: number;
  total_generated: number;
  questions: Question[];
  allQuestionIds: number[];
}

const typeOptions = [
  { value: 'choice_single', label: '单选题' },
  { value: 'choice_multi', label: '多选题' },
  { value: 'judgment', label: '判断题' },
  { value: 'essay', label: '简答题/作文' }
];

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];

const difficultyOptions = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' }
];

interface AssignmentsProps {
  onNavigate?: (menu: string) => void;
}

const Assignments: React.FC<AssignmentsProps> = ({ onNavigate }) => {
  const { user, checkAuth } = useAuthStore();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiTimeout, setAiTimeout] = useState<number>(300);
  
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isDoModalVisible, setIsDoModalVisible] = useState(false);
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [isStatsModalVisible, setIsStatsModalVisible] = useState(false);
  
  const [currentAssignment, setCurrentAssignment] = useState<any>(null);
  const [generatedData, setGeneratedData] = useState<GeneratedResult | null>(null);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [assignmentTablePage, setAssignmentTablePage] = useState(1);
  const [assignmentTablePageSize, setAssignmentTablePageSize] = useState(10);
  const [createModalTab, setCreateModalTab] = useState('generate');
  const [showVariantQuestions, setShowVariantQuestions] = useState<Record<number, boolean>>({});
  const [filterSubject, setFilterSubject] = useState<string | undefined>(undefined);
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  
  const [form] = Form.useForm();
  const [submitForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  
  const [generating, setGenerating] = useState(false);
  const [genLimit, setGenLimit] = useState<{ daily_limit: number; daily_used: number; daily_remaining: number; global_tokens_remaining: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, any>>({});
  const [uploadedImages, setUploadedImages] = useState<Record<number, string>>({});
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
  }, [selectedClass, filterSubject, filterDateRange]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (e) {
      console.error('加载班级列表失败');
    }
  };

  const loadAISettings = async () => {
    try {
      const res = await adminAPI.getSiteSettings();
      const timeout = parseInt(res.data.settings?.ai_timeout) || 300;
      setAiTimeout(timeout);
    } catch (e) {
      // 静默失败，使用默认值
    }
  };

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
      if (filterDateRange && filterDateRange[0]) params.date_from = filterDateRange[0].format('YYYY-MM-DD');
      if (filterDateRange && filterDateRange[1]) params.date_to = filterDateRange[1].format('YYYY-MM-DD');
      const res = await assignmentAPI.getAssignments(params);
      setAssignments(res.data.assignments || []);
    } catch (e) {
      console.error('加载作业失败:', e);
      message.error('加载作业失败');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuestions = async (values: any) => {
    setGenerating(true);
    try {
      const res = await assignmentAPI.generateQuestions({
        subject: values.subject,
        topic: values.topic,
        difficulty: values.difficulty,
        question_type: values.question_type,
        count: values.count || 10,
        grade_level: values.grade_level || ''
      }, aiTimeout);
      setGeneratedData(res.data as GeneratedResult);
      const nextDayMidnight = dayjs().add(1, 'day').startOf('day');
      const allClassIds = classes.map(c => c.id);
      form.setFieldsValue({
        title: res.data.title,
        description: res.data.description,
        question_type: res.data.question_type,
        subject: res.data.subject,
        class_ids: allClassIds,
        due_date: nextDayMidnight
      });
      setShowVariantQuestions({});
      setCreateModalTab('preview');
      message.success(`成功生成 ${res.data.question_count} 道题目（共${res.data.total_generated}道含变体）`);
      loadGenLimit();
    } catch (e: any) {
      if (e.code === 'ECONNABORTED') {
        message.error(`AI生成超时（${aiTimeout}秒），请稍后重试或联系管理员调整超时设置`);
      } else {
        const errMsg = e.response?.data?.error || 'AI生成失败';
        message.error(errMsg);
        if (e.response?.status === 429) {
          loadGenLimit();
        }
      }
    } finally {
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
      form.resetFields();
      setGeneratedData(null);
      generateForm.resetFields();
      loadAssignments();
    } catch (e: any) {
      message.error(e.response?.data?.error || '发布失败');
    }
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
      submitForm.resetFields();
      setProgressMilestones(new Set());
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
        image_url: uploadedImages[q.id] || ''
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
      
      if (res.data.success && !res.data.message?.includes('等待')) {
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
        
        // 5秒后自动隐藏
        setTimeout(() => {
          setShowCelebration(false);
        }, 5000);
      } else {
        message.info(res.data.message || '已提交');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadImage = async (questionId: number, file: File) => {
    try {
      const res = await assignmentAPI.uploadImage(file);
      setUploadedImages(prev => ({ ...prev, [questionId]: res.data.url }));
      message.success('图片上传成功');
    } catch (e: any) {
      message.error(e.response?.data?.error || '上传失败');
    }
  };
  
  // 打开题目编辑
  const handleEditQuestion = (question: Question, index: number, variantParentIndex?: number, variantIndex?: number) => {
    setEditingQuestion(question);
    setEditingQuestionIndex(index);
    setEditingVariantParentIndex(variantParentIndex ?? -1);
    setEditingVariantIndex(variantIndex ?? -1);
    let answerValue: any = question.answer || '';
    if (question.type === 'choice_multi' && typeof answerValue === 'string') {
      answerValue = answerValue.split(',').map(a => a.trim()).filter(Boolean);
    }
    editForm.setFieldsValue({
      content: question.content,
      options: question.options ? question.options.join('\n') : '',
      difficulty: 'medium',
      knowledge_point: question.knowledge_point || '',
      answer: answerValue,
      explanation: question.explanation || '',
      analysis: ''
    });
    setEditModalVisible(true);
  };
  
  // 保存题目编辑
  const handleSaveEdit = async (values: any) => {
    if (!editingQuestion) return;
    
    const newOptions = values.options ? values.options.split('\n').filter((opt: string) => opt.trim()) : null;
    const isObjective = ['choice_single', 'choice_multi', 'judgment'].includes(editingQuestion.type);
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
      submitForm.resetFields();
      setProgressMilestones(new Set());
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
    const isEssay = q.type === 'essay';
    const isChoiceSingle = q.type === 'choice_single';
    const isChoiceMulti = q.type === 'choice_multi';
    const isJudgment = q.type === 'judgment';
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

        {isEssay && !isTeacher && (
          <>
            <TextArea 
              rows={4} 
              placeholder="在此输入你的答案..."
              value={studentAnswers[q.id!] || ''}
              onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
              style={{ marginBottom: 8 }}
            />
            <div>
              <Upload
                beforeUpload={(file) => { handleUploadImage(q.id!, file); return false; }}
                showUploadList={false}
                accept="image/*"
              >
                <Button icon={<CameraOutlined />} size="small">
                  {uploadedImages[q.id!] ? '更换图片' : '上传作答图片'}
                </Button>
              </Upload>
              {uploadedImages[q.id!] && (
                <div style={{ marginTop: 8 }}>
                  <Image src={uploadedImages[q.id!]} width={200} style={{ borderRadius: 6 }} />
                </div>
              )}
              <Alert 
                type="warning" 
                showIcon 
                message="主观题仅有一次提交机会，请确认答案后提交" 
                style={{ marginTop: 8 }} 
              />
            </div>
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
              let answerVal: any = q.answer || '';
              editForm.setFieldsValue({
                content: q.content,
                options: q.options ? q.options.join('\n') : '',
                difficulty: q.difficulty || 'medium',
                knowledge_point: q.knowledge_point || '',
                answer: answerVal,
                explanation: q.explanation || '',
                analysis: q.analysis || ''
              });
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
              editForm.setFieldsValue({
                content: q.content,
                options: q.options ? q.options.join('\n') : '',
                difficulty: q.difficulty || 'medium',
                knowledge_point: q.knowledge_point || '',
                answer: answerVal,
                explanation: q.explanation || '',
                analysis: q.analysis || ''
              });
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
                    editForm.setFieldsValue({
                      content: v.content,
                      options: v.options ? v.options.join('\n') : '',
                      difficulty: v.difficulty || 'medium',
                      knowledge_point: v.knowledge_point || '',
                      answer: answerVal,
                      explanation: v.explanation || '',
                      analysis: v.analysis || ''
                    });
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

  const isOverdue = (date: string) => dayjs(date).isBefore(dayjs());

  const getStatusTag = (record: any) => {
    if (record.status === 'cancelled') return <Tag color="default" icon={<StopOutlined />}>已取消</Tag>;
    if (!record.my_submission_id) {
      if (isOverdue(record.due_date)) return <Tag color="error" icon={<CloseCircleOutlined />}>已过期</Tag>;
      return <Tag color="processing">待完成</Tag>;
    }
    if (record.my_submission_status === 'retry_available') return <Tag color="warning" icon={<ReloadOutlined />}>可重做</Tag>;
    const score = record.my_score;
    if (score >= 90) return <Tag color="success" icon={<CheckCircleOutlined />}>优秀 {score}分</Tag>;
    if (score >= 60) return <Tag color="blue">及格 {score}分</Tag>;
    return <Tag color="error">需努力 {score}分</Tag>;
  };

  const columns = [
    { title: '作业标题', dataIndex: 'title', key: 'title', render: (text: string, r: any) => (
      <div>
        <a style={{ fontWeight: 500 }}>{text}</a>
        {r.my_submission_id && (
          <div style={{ fontSize: 12, color: '#999' }}>
            最高得分：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{r.my_score || 0}</span> 分
            {r.my_gold_reward > 0 && <span style={{ color: '#faad14', marginLeft: 8 }}>+{r.my_gold_reward}💰</span>}
          </div>
        )}
      </div>
    )},
    { title: '班级', dataIndex: 'class_name', key: 'class_name', responsive: ['md'] as any, render: (name: string) => name ? <Tag color="green">{name}</Tag> : <Tag>未分班</Tag> },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (subject: string) => <Tag color="blue">{subject}</Tag> },
    { title: '题型', dataIndex: 'question_type', key: 'question_type', responsive: ['md'] as any, render: (type: string) => <Tag color="purple">{typeOptions.find(t => t.value === type)?.label || type}</Tag> },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count', responsive: ['md'] as any, render: (count: number) => count ?? '-' },
    { title: '金币奖励', dataIndex: 'max_exp', key: 'max_exp', responsive: ['md'] as any, render: (exp: number) => <span style={{ color: '#faad14', fontWeight: 'bold' }}>+{exp} 金币</span> },
    { 
      title: '截止日期', dataIndex: 'due_date', key: 'due_date', responsive: ['sm'] as any,
      render: (date: string) => {
        const d = dayjs(date);
        const overdue = d.isBefore(dayjs());
        return <span style={{ color: overdue ? '#ff4d4f' : undefined, fontWeight: overdue ? 'bold' : undefined }}>
          {d.format('YYYY-MM-DD HH:mm')}
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
            <Button size="small" icon={<EyeOutlined />} onClick={async () => {
              try {
                const res = await assignmentAPI.getSubmissionDetail(record.my_submission_id);
                setSubmitResult({ results: res.data.answers, total_score: res.data.submission.total_score, total_max_score: res.data.submission.total_max_score, gold_reward: res.data.submission.gold_reward, correct_count: res.data.answers.filter((a: any) => a.is_correct).length, total_count: res.data.answers.length });
                setIsResultModalVisible(true);
              } catch(e) { message.error('获取结果失败'); }
            }}>查看结果</Button>
          )}
          {isTeacher && (
            <>
              {record.teacher_id === user?.id && (
                <Button size="small" icon={<EditOutlined />} onClick={() => handleStartDoing(record)}>编辑</Button>
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
            <Button type="primary" icon={<RobotOutlined />} onClick={() => { setIsCreateModalVisible(true); setGeneratedData(null); generateForm.resetFields(); form.resetFields(); setCreateModalTab('generate'); setShowVariantQuestions({}); loadGenLimit(); }}>
              发布新作业
            </Button>
          )}
        </Space>
      </div>

      {isMobile ? (
        <div>
          {assignments.length === 0 && !loading && <Empty description="暂无作业" />}
          {assignments.map((record: any) => (
            <Card key={record.id} size="small" style={{ marginBottom: 12, borderRadius: 8 }} onClick={() => {}}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>{record.title}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Tag color="blue">{record.subject}</Tag>
                    {record.class_name && <Tag color="green">{record.class_name}</Tag>}
                    {getStatusTag(record)}
                  </div>
                </div>
                <span style={{ color: '#faad14', fontWeight: 'bold', fontSize: 13, whiteSpace: 'nowrap' }}>+{record.max_exp}💰</span>
              </div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                {record.question_count}道题 · 截止 {dayjs(record.due_date).format('MM-DD HH:mm')}
                {isOverdue(record.due_date) && <span style={{ color: '#ff4d4f', marginLeft: 4 }}>已过期</span>}
              </div>
              {record.my_submission_id && (
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  最高得分：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{record.my_score || 0}</span> 分
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
                  <Button size="small" icon={<EyeOutlined />} onClick={async () => {
                    try {
                      const res = await assignmentAPI.getSubmissionDetail(record.my_submission_id);
                      setSubmitResult({ results: res.data.answers, total_score: res.data.submission.total_score, total_max_score: res.data.submission.total_max_score, gold_reward: res.data.submission.gold_reward, correct_count: res.data.answers.filter((a: any) => a.is_correct).length, total_count: res.data.answers.length });
                      setIsResultModalVisible(true);
                    } catch(e) { message.error('获取结果失败'); }
                  }}>查看结果</Button>
                )}
                {isTeacher && record.teacher_id === user?.id && (
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleStartDoing(record)}>编辑</Button>
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

      {/* 教师发布作业弹窗 */}
      <Modal
        title="🤖 发布新作业（AI智能生成）"
        open={isCreateModalVisible}
        onCancel={() => { setIsCreateModalVisible(false); setGeneratedData(null); }}
        width={isMobile ? '95vw' : 780}
        destroyOnHidden
        footer={null}
      >
        <Tabs activeKey={createModalTab} onChange={(key) => setCreateModalTab(key)} items={[
          {
            key: 'generate',
            label: '1. AI生成题目',
            children: (
              <Form form={generateForm} layout="vertical" onFinish={handleGenerateQuestions}>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="subject" label="科目" rules={[{ required: true }]}>
                      <Select placeholder="选择科目">
                        {subjectOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="question_type" label="题型（每次仅一种）" rules={[{ required: true }]}>
                      <Select placeholder="选择题型">
                        {typeOptions.map(t => <Option key={t.value} value={t.value}>{t.label}</Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="topic" label="知识点主题" rules={[{ required: true }]}>
                  <Input placeholder="例如：二次函数顶点坐标、古诗词默写、牛顿第二定律..." />
                </Form.Item>
                <Row gutter={16}>
                  <Col xs={12} sm={8}>
                    <Form.Item name="difficulty" label="难度" initialValue="medium">
                      <Select>{difficultyOptions.map(d => <Option key={d.value} value={d.value}>{d.label}</Option>)}</Select>
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8}>
                    <Form.Item name="count" label="题目数量" initialValue={10}>
                      <InputNumber min={3} max={20} style={{ width: '100%' }} addonAfter="道" />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8}>
                    <Form.Item name="grade_level" label="年级（可选）">
                      <Input placeholder="如：高一、初三" />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" block icon={generating ? <LoadingOutlined /> : <RobotOutlined />} loading={generating} disabled={genLimit ? genLimit.daily_remaining <= 0 : false}>
                  {generating ? 'AI正在生成中...' : '🤖 AI生成题目'}
                </Button>
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
                  提示：实际将生成 N×3 道题（每道题有2个变体），用于学生做错时提供相似新题
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
                  message={`共${generatedData.question_count}道主题，含${generatedData.total_generated}道含变体。点击"编辑"可修改题目内容/答案，点击"▼ 查看变体题目"查看备用题`} 
                  style={{ marginBottom: 12 }} 
                />
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
                <Form.Item name="description" label="作业说明" initialValue={generatedData.description}>
                  <TextArea rows={2} />
                </Form.Item>

                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="max_exp" label="金币奖励" rules={[{ required: true }]} initialValue={30}>
                      <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="金币" />
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
              <Button type="primary" loading={submitting} onClick={handleSubmitAnswers}>
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
            
            {currentAssignment.questions?.map((_: Question, _si: number) => {
              const i = shuffledQuestionOrder.length > 0 ? shuffledQuestionOrder[_si] : _si;
              return renderQuestionForStudent(currentAssignment.questions[i], _si);
            })}
          </div>
        )}
      </Modal>

      {/* 作答结果弹窗 */}
      <Modal
        title={submitResult?.message?.includes('等待') ? '📝 提交成功' : '✅ 作答完成！'}
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
            {!submitResult.message?.includes('等待') && (
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

              {submitResult.message?.includes('等待') && (
                <Alert type="info" showIcon message="你的主观题已提交，AI正在评阅中，稍后可在'查看结果'中查看评分。" style={{ marginTop: 12 }} />
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
                      { title: '姓名', dataIndex: 'username' },
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
