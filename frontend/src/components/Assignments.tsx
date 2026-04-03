import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Modal, Form, Input, DatePicker, Select, InputNumber, message, Space, Radio, Checkbox, Progress, Card, Alert, Upload, Image, Divider, Empty, Statistic, Row, Col, Tabs, Badge } from 'antd';
import { assignmentAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, BookOutlined, EyeOutlined, BarChartOutlined, RobotOutlined, LoadingOutlined, CameraOutlined } from '@ant-design/icons';

const { Option } = Select;
const { TextArea } = Input;

interface Question {
  id?: number;
  tempId?: number;
  variantIds?: number[];
  content: string;
  options?: string[] | null;
  type: string;
  hasVariants?: boolean;
}

interface GeneratedResult {
  message: string;
  title: string;
  description: string;
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

const Assignments: React.FC = () => {
  const { user } = useAuthStore();
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
  const [statsData, setStatsData] = useState<any>(null);
  
  const [form] = Form.useForm();
  const [submitForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, any>>({});
  const [uploadedImages, setUploadedImages] = useState<Record<number, string>>({});

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (user) {
      loadAssignments();
      if (isAdmin) loadClasses();
    }
  }, [user]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      let allClasses = res.data.classes || [];
      if (!isAdmin) {
        allClasses = allClasses.filter((c: any) => c.teachers?.some((t: any) => t.teacher_id === user?.id));
      }
      setClasses(allClasses);
    } catch (e) {
      console.error('加载班级列表失败');
    }
  };

  const loadAssignments = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const params = selectedClass ? { class_id: selectedClass } : {};
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
      });
      setGeneratedData(res.data as GeneratedResult);
      form.setFieldsValue({
        title: res.data.title,
        description: res.data.description,
        question_type: res.data.question_type
      });
      message.success(`成功生成 ${res.data.question_count} 道题目（共${res.data.total_generated}道含变体）`);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'AI生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateAssignment = async (values: any) => {
    try {
      const payload = {
        ...values,
        due_date: values.due_date.toISOString(),
        class_id: values.class_id || selectedClass,
        question_ids: generatedData?.allQuestionIds || [],
        ai_config: { auto_grade: true, question_type: values.question_type }
      };
      await assignmentAPI.createAssignment(payload);
      message.success('作业发布成功！');
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
      setCurrentAssignment(res.data.assignment);
      setStudentAnswers({});
      setUploadedImages({});
      submitForm.resetFields();
      setIsDoModalVisible(true);
    } catch (e: any) {
      message.error(e.response?.data?.error || '获取作业详情失败');
    }
  };

  const handleSubmitAnswers = async () => {
    const questions = currentAssignment?.questions || [];
    if (questions.length === 0) return;

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

  const handleRetryWrong = () => {
    if (!submitResult?.wrong_questions || submitResult.wrong_questions.length === 0) return;
    
    const wrongQs = submitResult.wrong_questions;
    const retryQuestions = wrongQs.map((wq: any) => ({
      ...wq.retry_question,
      originalId: wq.original_question_id
    }));
    
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

  const handleViewStatistics = async (record: any) => {
    try {
      const res = await assignmentAPI.getStatistics(record.id);
      setStatsData(res.data);
      setIsStatsModalVisible(true);
    } catch (e: any) {
      message.error(e.response?.data?.error || '获取统计失败');
    }
  };

  const renderQuestionForStudent = (q: Question, index: number) => {
    const isEssay = q.type === 'essay';
    const isChoiceSingle = q.type === 'choice_single';
    const isChoiceMulti = q.type === 'choice_multi';
    const isJudgment = q.type === 'judgment';

    return (
      <Card 
        key={q.id || q.tempId} 
        size="small" 
        style={{ marginBottom: 16, borderLeft: '4px solid #1890ff' }}
        title={<span>第 {index + 1} 题 <Tag color="blue">{typeOptions.find(t => t.value === q.type)?.label || q.type}</Tag></span>}
      >
        <div style={{ marginBottom: 12, fontSize: 15, lineHeight: 1.8 }}>{q.content}</div>
        
        {(isChoiceSingle || isChoiceMulti) && q.options && (
          <div style={{ marginLeft: 8 }}>
            {isChoiceSingle ? (
              <Radio.Group 
                onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
                value={studentAnswers[q.id!] || null}
              >
                {q.options.map((opt, idx) => (
                  <Radio key={idx} value={String.fromCharCode(65 + idx)} style={{ marginBottom: 8, display: 'block' }}>
                    <span style={{ fontWeight: 500, marginRight: 8 }}>{String.fromCharCode(65 + idx)}.</span>{opt}
                  </Radio>
                ))}
              </Radio.Group>
            ) : (
              <Checkbox.Group
                onChange={(vals) => setStudentAnswers(prev => ({ ...prev, [q.id!]: vals }))}
                value={studentAnswers[q.id!] || []}
                style={{ width: '100%' }}
              >
                {q.options.map((opt, idx) => (
                  <div key={idx} style={{ marginBottom: 8 }}>
                    <Checkbox value={String.fromCharCode(65 + idx)}>
                      <span style={{ fontWeight: 500, marginRight: 8 }}>{String.fromCharCode(65 + idx)}.</span>{opt}
                    </Checkbox>
                  </div>
                ))}
              </Checkbox.Group>
            )}
          </div>
        )}

        {isJudgment && (
          <Radio.Group 
            onChange={(e) => setStudentAnswers(prev => ({ ...prev, [q.id!]: e.target.value }))}
            value={studentAnswers[q.id!] || null}
            style={{ marginLeft: 8 }}
          >
            <Radio value="true" style={{ marginRight: 24 }}>正确</Radio>
            <Radio value="false">错误</Radio>
          </Radio.Group>
        )}

        {isEssay && (
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
              <Tag icon={<CheckCircleOutlined />} color="success">正确</Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">错误</Tag>
            )}
          </div>
          <div style={{ color: '#666', marginBottom: 4 }}>{r.question_content}</div>
          <div>
            <span style={{ color: '#999' }}>你的答案：</span>
            <span style={{ color: r.is_correct ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>{String(r.user_answer || '(未作答)')}</span>
            {!r.is_correct && (
              <span style={{ marginLeft: 16, color: '#999' }}>正确答案：<span style={{ color: '#52c41a', fontWeight: 500 }}>{r.correct_answer}</span></span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 60 }}>
          <Statistic title="得分" value={Math.round(r.score || 0)} suffix={`/ ${Math.round(r.max_score || 0)}`} valueStyle={{ fontSize: 18, color: r.is_correct ? '#52c41a' : '#ff4d4f' }} />
        </div>
      </div>
      {r.explanation && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 13 }}>
          <strong style={{ color: '#1890ff' }}>解析：</strong><span style={{ color: '#555' }}>{r.explanation}</span>
        </div>
      )}
    </Card>
  );

  const columns = [
    { title: '作业标题', dataIndex: 'title', key: 'title', render: (text: string) => <a>{text}</a> },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (name: string) => name ? <Tag color="green">{name}</Tag> : <Tag>未分班</Tag> },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (subject: string) => <Tag color="blue">{subject}</Tag> },
    { title: '题型', dataIndex: 'question_type', key: 'question_type', render: (type: string) => <Tag color="purple">{typeOptions.find(t => t.value === type)?.label || type}</Tag> },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count', render: (count: number) => count ?? '-' },
    { title: '金币奖励', dataIndex: 'max_exp', key: 'max_exp', render: (exp: number) => <span style={{ color: '#faad14', fontWeight: 'bold' }}>+{exp} 金币</span> },
    { title: '截止日期', dataIndex: 'due_date', key: 'due_date', render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: any, record: any) => (
        <Space size="small">
          {!isTeacher && record.my_submission_id ? (
            <Button type="link" size="small" onClick={async () => {
              try {
                const res = await assignmentAPI.getSubmissionDetail(record.my_submission_id);
                setSubmitResult({ results: res.data.answers, total_score: res.data.submission.total_score, total_max_score: res.data.submission.total_max_score, gold_reward: res.data.submission.gold_reward, correct_count: res.data.answers.filter((a: any) => a.is_correct).length, total_count: res.data.answers.length });
                setIsResultModalVisible(true);
              } catch(e) { message.error('获取结果失败'); }
            }}>查看结果</Button>
          ) : !isTeacher ? (
            <Button type="primary" size="small" onClick={() => handleStartDoing(record)}>去完成</Button>
          ) : null}
          {isTeacher && (
            <>
              <Button size="small" icon={<EyeOutlined />} onClick={() => handleStartDoing(record)}>预览</Button>
              <Button size="small" icon={<BarChartOutlined />} onClick={() => handleViewStatistics(record)}>统计</Button>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2 style={{ margin: 0 }}>📝 班级作业</h2>
          {isAdmin && (
            <Select placeholder="筛选班级" allowClear style={{ width: 200 }} onChange={(v) => { setSelectedClass(v); loadAssignments(); }} value={selectedClass}>
              {classes.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
            </Select>
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
            <Button type="primary" icon={<RobotOutlined />} onClick={() => { setIsCreateModalVisible(true); setGeneratedData(null); generateForm.resetFields(); form.resetFields(); }}>
              发布新作业
            </Button>
          )}
        </Space>
      </div>

      <Table columns={columns} dataSource={assignments} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

      {/* 教师发布作业弹窗 */}
      <Modal
        title="🤖 发布新作业（AI智能生成）"
        open={isCreateModalVisible}
        onCancel={() => { setIsCreateModalVisible(false); setGeneratedData(null); }}
        width={720}
        destroyOnClose
        footer={null}
      >
        <Tabs defaultActiveKey="generate" items={[
          {
            key: 'generate',
            label: '1. AI生成题目',
            children: (
              <Form form={generateForm} layout="vertical" onFinish={handleGenerateQuestions}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="subject" label="科目" rules={[{ required: true }]}>
                      <Select placeholder="选择科目">
                        {subjectOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
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
                  <Col span={8}>
                    <Form.Item name="difficulty" label="难度" initialValue="medium">
                      <Select>{difficultyOptions.map(d => <Option key={d.value} value={d.value}>{d.label}</Option>)}</Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="count" label="题目数量" initialValue={10}>
                      <InputNumber min={3} max={20} style={{ width: '100%' }} addonAfter="道" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="grade_level" label="年级（可选）">
                      <Input placeholder="如：高一、初三" />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" block icon={generating ? <LoadingOutlined /> : <RobotOutlined />} loading={generating}>
                  {generating ? 'AI正在生成中...' : '🤖 AI生成题目'}
                </Button>
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 8 }}>
                  提示：实际将生成 N×3 道题（每道题2个变体），用于学生做错时提供相似新题
                </div>
              </Form>
            )
          },
          {
            key: 'publish',
            label: '2. 预览并发布',
            disabled: !generatedData,
            children: generatedData ? (
              <Form form={form} layout="vertical" onFinish={handleCreateAssignment}>
                {(isAdmin || user?.role === 'teacher') && (
                  <Form.Item name="class_id" label="发布到班级" rules={[{ required: true }]}>
                    <Select placeholder="选择班级">{classes.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}</Select>
                  </Form.Item>
                )}
                <Form.Item name="title" label="作业标题" rules={[{ required: true }]} initialValue={generatedData.title}>
                  <Input />
                </Form.Item>
                <Form.Item name="description" label="作业说明" initialValue={generatedData.description}>
                  <TextArea rows={2} />
                </Form.Item>
                
                <Divider orientation="left">题目预览（共{generatedData.question_count}道）</Divider>
                <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
                  {generatedData.questions.map((q, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: i % 2 === 0 ? '#fafafa' : '#fff', borderRadius: 6, marginBottom: 4 }}>
                      <strong>Q{i + 1}.</strong> [{typeOptions.find(t => t.value === q.type)?.label}] {q.content}
                      {q.hasVariants && <Tag color="orange" style={{ marginLeft: 8 }}>含变体</Tag>}
                    </div>
                  ))}
                </div>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="max_exp" label="金币奖励" rules={[{ required: true }]} initialValue={30}>
                      <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="金币" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="due_date" label="截止日期" rules={[{ required: true }]}>
                      <DatePicker showTime style={{ width: '100%' }} disabledDate={(current) => current && current < dayjs().startOf('day')} />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item name="question_type" hidden initialValue={generatedData.question_type}><Input /></Form.Item>
                <Form.Item name="subject" hidden initialValue={''}><Input /></Form.Item>

                <Button type="primary" htmlType="submit" block>确认发布作业</Button>
              </Form>
            ) : (
              <Empty description="请先生成题目" />
            )
          }
        ]} />
      </Modal>

      {/* 学生作答弹窗 */}
      <Modal
        title={`📝 ${currentAssignment?.isRetryMode ? '错题重做' : '完成作业'}: ${currentAssignment?.title || ''}`}
        open={isDoModalVisible}
        onCancel={() => setIsDoModalVisible(false)}
        width={700}
        destroyOnClose
        okText={submitting ? "提交中..." : "提交答案"}
        cancelText="取消"
        onOk={handleSubmitAnswers}
        confirmLoading={submitting}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' } }}
      >
        {currentAssignment && (
          <div>
            <Alert 
              type={currentAssignment.isRetryMode ? "warning" : "info"} 
              showIcon 
              message={
                currentAssignment.isRetryMode 
                  ? "这是根据你之前做错的题目生成的相似题，再试一次吧！" 
                  : `${currentAssignment.subject} | 共${currentAssignment.questions?.length || 0}道题 | 金币奖励: +${currentAssignment.max_exp}`
              } 
              style={{ marginBottom: 16 }} 
            />
            
            {currentAssignment.questions?.map((q: Question, i: number) => renderQuestionForStudent(q, i))}

            <div style={{ padding: '12px 0', borderTop: '1px dashed #eee', marginTop: 8 }}>
              <Progress 
                percent={Math.round(((currentAssignment.questions || []).filter((q: Question) => {
                  const a = studentAnswers[q.id!];
                  return a !== undefined && a !== null && a !== '';
                }).length / (currentAssignment.questions?.length || 1)) * 100)} 
                status="active"
                format={(_p) => `已完成 ${(currentAssignment.questions || []).filter((q: Question) => studentAnswers[q.id!] !== undefined && studentAnswers[q.id!] !== null && studentAnswers[q.id!] !== '').length}/${currentAssignment.questions?.length || 0} 题`}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 作答结果弹窗 */}
      <Modal
        title={`✅ 作答完成！`}
        open={isResultModalVisible}
        onCancel={() => setIsResultModalVisible(false)}
        width={650}
        destroyOnClose
        footer={
          <Space>
            {submitResult?.can_retry && (
              <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetryWrong}>重做错题</Button>
            )}
            <Button onClick={() => setIsResultModalVisible(false)}>关闭</Button>
          </Space>
        }
      >
        {submitResult && (
          <div>
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col span={8}>
                <Card size="small"><Statistic title="总分" value={submitResult.total_score} suffix={`/ ${submitResult.total_max_score}`} valueStyle={{ color: submitResult.total_score >= 60 ? '#52c41a' : '#ff4d4f', fontSize: 28 }} /></Card>
              </Col>
              <Col span={8}>
                <Card size="small"><Statistic title="获得金币" value={submitResult.gold_reward} prefix="+" suffix="枚" valueStyle={{ color: '#faad14', fontSize: 28 }} /></Card>
              </Col>
              <Col span={8}>
                <Card size="small"><Statistic title="正确率" value={submitResult.total_count > 0 ? Math.round(submitResult.correct_count / submitResult.total_count * 100) : 0} suffix="%" valueStyle={{ fontSize: 28 }} /></Card>
              </Col>
            </Row>

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
        title={`📊 作业统计: ${statsData ? assignments.find(a => a.id === statsData.assignment_id)?.title : ''}`}
        open={isStatsModalVisible}
        onCancel={() => setIsStatsModalVisible(false)}
        width={800}
        destroyOnClose
        footer={<Button onClick={() => setIsStatsModalVisible(false)}>关闭</Button>}
      >
        {statsData && (
          <div>
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col span={6}><Card size="small"><Statistic title="全班人数" value={statsData.total_students} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="已提交" value={statsData.submitted_count} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="完成率" value={statsData.completion_rate} suffix="%" valueStyle={{ color: statsData.completion_rate >= 80 ? '#52c41a' : '#ff4d4f' }} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="平均分" value={statsData.average_score} /></Card></Col>
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
                          <span><strong>第{i + 1}题</strong> <Tag>{typeOptions.find(t => t.value === qs.type)?.label || qs.type}</Tag></span>
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
                    scroll={{ y: 300 }}
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
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Assignments;
