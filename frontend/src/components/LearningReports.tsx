import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Statistic, Select, DatePicker, Table, Tag, Button, Space, Spin, Empty,
  message, Progress, Tabs, Tooltip, Drawer, Descriptions, List, Divider, Alert,
} from 'antd';
import {
  DownloadOutlined, RobotOutlined, ReloadOutlined, FileTextOutlined,
  WarningOutlined, CheckCircleOutlined, HistoryOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { learningReportAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { AccuracyColumn, TrendLine, CountColumn, DistributionPie } from './charts/ChartKit';
import { exportTableFile, ExportFormat } from './admin/_common';

const { RangePicker } = DatePicker;

const SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];

const MASTERY_META: Record<string, { color: string; text: string }> = {
  mastered: { color: 'green', text: '已掌握' },
  normal: { color: 'blue', text: '一般' },
  weak: { color: 'red', text: '薄弱' },
  unknown: { color: 'default', text: '数据不足' },
};

const LearningReports: React.FC = () => {
  const { user } = useAuthStore();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState<number | undefined>(undefined);
  const [subject, setSubject] = useState<string>('all');
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, 'day'), dayjs()]);

  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [matrix, setMatrix] = useState<any>(null);
  const [studentList, setStudentList] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // AI 报告
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);
  const [aiMeta, setAiMeta] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 学生画像抽屉
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stuAiLoading, setStuAiLoading] = useState(false);
  const [stuAiReport, setStuAiReport] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminAPI.getStatistics();
        const list = res.data?.statistics?.classes?.list || [];
        setClasses(list);
        if (list.length > 0) setClassId(list[0].id);
      } catch (e) {
        message.error('加载班级列表失败');
      }
    })();
  }, [user]);

  const query = useMemo(() => ({
    class_id: classId as number,
    subject,
    date_from: range?.[0]?.format('YYYY-MM-DD'),
    date_to: range?.[1]?.format('YYYY-MM-DD'),
  }), [classId, subject, range]);

  const loadAll = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const [ov, mx, st] = await Promise.all([
        learningReportAPI.getOverview(query),
        learningReportAPI.getKnowledgeMatrix(query).catch(() => null),
        learningReportAPI.getStudents(query).catch(() => null),
      ]);
      setOverview(ov.data);
      setMatrix(mx?.data || null);
      setStudentList(st?.data || null);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载学情报告失败');
    } finally {
      setLoading(false);
    }
  }, [classId, query]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadHistory = async () => {
    if (!classId) return;
    setHistoryLoading(true);
    try {
      const res = await learningReportAPI.getAiReportHistory({ class_id: classId, limit: 30 });
      setHistory(res.data.reports || []);
    } catch (e) {
      message.error('加载报告历史失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!classId) return;
    setAiLoading(true);
    try {
      const res = await learningReportAPI.generateAiReport({
        class_id: classId, subject,
        date_from: query.date_from, date_to: query.date_to,
      });
      setAiReport(res.data.report);
      setAiMeta({ model: res.data.model, range: res.data.range, subject: res.data.subject, id: res.data.report_id });
      message.success('AI 报告已生成');
      loadHistory();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '生成失败');
    } finally {
      setAiLoading(false);
    }
  };

  const openStudentDetail = async (studentId: number) => {
    setDetailLoading(true);
    setStuAiReport(null);
    setDetail({ loading: true });
    try {
      const res = await learningReportAPI.getStudentReport({ ...query, studentId });
      setDetail(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载学生画像失败');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleGenerateStudentAi = async (studentId: number) => {
    setStuAiLoading(true);
    try {
      const res = await learningReportAPI.generateStudentAiReport({
        class_id: classId as number, student_id: studentId, subject,
        date_from: query.date_from, date_to: query.date_to,
      });
      setStuAiReport(res.data.report);
      message.success('已生成该生的教师视角报告');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '生成失败');
    } finally {
      setStuAiLoading(false);
    }
  };

  const handleExportStudents = async (format: ExportFormat) => {
    const list = studentList?.students || [];
    if (list.length === 0) { message.warning('没有可导出的数据'); return; }
    await exportTableFile(
      ['姓名', '答题数', '答对', '正确率(%)', '掌握度', '独立题数', '错题数', '待复习错题', '作业完成', '完成率(%)', '最近作答'],
      list.map((s: any) => [
        s.real_name || s.username, s.attempts, s.correct, s.accuracy,
        MASTERY_META[s.mastery]?.text || s.mastery, s.distinct_questions,
        s.wrong_total, s.wrong_unreviewed, s.submitted_assignments, s.completion_rate,
        s.last_answer_at || '',
      ]),
      format,
      `学情报告_${overview?.class?.name || ''}_${subject === 'all' ? '全部学科' : subject}`,
      '学情'
    );
    message.success('已导出');
  };

  const handleExportMatrix = async (format: ExportFormat) => {
    if (!matrix?.knowledge_points?.length) { message.warning('没有可导出的数据'); return; }
    const kps = matrix.knowledge_points.map((k: any) => k.knowledge_point);
    await exportTableFile(
      ['姓名', ...kps],
      (matrix.matrix || []).map((r: any) => [
        r.real_name || r.username,
        ...kps.map((k: string) => (r.points[k] ? `${r.points[k].accuracy}% (${r.points[k].attempts}题)` : '—')),
      ]),
      format,
      `知识点掌握矩阵_${overview?.class?.name || ''}`,
      '知识点矩阵'
    );
    message.success('已导出');
  };

  const handleExportReport = async () => {
    if (!aiReport) return;
    const rows: any[][] = [];
    rows.push(['报告类型', '班级学情分析报告']);
    rows.push(['统计区间', `${aiMeta?.range?.start || ''} ~ ${aiMeta?.range?.end || ''}`]);
    rows.push(['学科范围', aiMeta?.subject || '全部学科']);
    rows.push(['综合得分', String(aiReport.overall_score ?? '')]);
    rows.push(['水平评定', aiReport.level || '']);
    rows.push(['整体概述', aiReport.summary || '']);
    rows.push(['成因分析', aiReport.root_cause_analysis || '']);
    (aiReport.strengths || []).forEach((s: string, i: number) => rows.push([`优势${i + 1}`, s]));
    (aiReport.weaknesses || []).forEach((s: string, i: number) => rows.push([`问题${i + 1}`, s]));
    (aiReport.next_focus_points || []).forEach((s: string, i: number) => rows.push([`下阶段重点${i + 1}`, s]));
    (aiReport.teaching_suggestions || []).forEach((s: any, i: number) =>
      rows.push([`教学建议${i + 1}(${s.priority})`, `${s.action}｜预期：${s.expected_effect || ''}`]));
    (aiReport.focus_students || []).forEach((s: any, i: number) =>
      rows.push([`关注学生${i + 1}`, `${s.name}：${s.reason}｜建议：${s.suggestion}`]));
    if (aiReport.parent_communication) rows.push(['家长沟通建议', aiReport.parent_communication]);

    await exportTableFile(['项目', '内容'], rows, 'xlsx', `AI学情报告_${overview?.class?.name || ''}`, 'AI报告');
    message.success('已导出');
  };

  if (classes.length === 0) {
    return <Empty description="暂无可查看的班级" />;
  }

  const kpi = overview?.kpi;
  const dailyData = (overview?.daily || []).map((d: any) => ({ date: d.date, value: d.accuracy }));
  const subjectData = (overview?.by_subject || []).map((s: any) => ({ name: s.subject, value: s.accuracy }));
  const typeData = (overview?.by_type || []).map((t: any) => ({ type: t.label, value: t.total }));

  const studentColumns = [
    {
      title: '姓名', dataIndex: 'real_name', key: 'real_name', width: 110,
      render: (v: string, r: any) => (
        <a onClick={() => openStudentDetail(r.user_id)}>{v || r.username}</a>
      ),
    },
    { title: '答题数', dataIndex: 'attempts', key: 'attempts', width: 80, sorter: (a: any, b: any) => a.attempts - b.attempts },
    {
      title: '正确率', dataIndex: 'accuracy', key: 'accuracy', width: 140, sorter: (a: any, b: any) => a.accuracy - b.accuracy,
      render: (v: number) => (
        <Progress percent={v} size="small" strokeColor={v >= 80 ? '#52c41a' : v >= 60 ? '#1890ff' : '#ff4d4f'} />
      ),
    },
    {
      title: '掌握度', dataIndex: 'mastery', key: 'mastery', width: 90,
      render: (v: string) => <Tag color={MASTERY_META[v]?.color}>{MASTERY_META[v]?.text || v}</Tag>,
    },
    { title: '独立题数', dataIndex: 'distinct_questions', key: 'distinct_questions', width: 90, responsive: ['md'] as any },
    {
      title: '错题(待复习)', dataIndex: 'wrong_unreviewed', key: 'wrong_unreviewed', width: 110,
      render: (v: number, r: any) => (
        <span style={{ color: r.wrong_unreviewed > 0 ? '#ff4d4f' : undefined }}>
          {r.wrong_total}（{v}）
        </span>
      ),
    },
    {
      title: '作业完成', key: 'assign', width: 110, responsive: ['lg'] as any,
      render: (_: any, r: any) => `${r.submitted_assignments}/${r.total_assignments}（${r.completion_rate}%）`,
    },
    {
      title: '最近作答', dataIndex: 'last_answer_at', key: 'last_answer_at', width: 110, responsive: ['lg'] as any,
      render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : <span style={{ color: '#bbb' }}>无</span>),
    },
  ];

  return (
    <div>
      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            style={{ width: 180 }}
            value={classId}
            onChange={setClassId}
            options={classes.map((c: any) => ({ value: c.id, label: c.name }))}
            placeholder="选择班级"
          />
          <Select
            style={{ width: 140 }}
            value={subject}
            onChange={setSubject}
            options={[{ value: 'all', label: '全部学科' }, ...SUBJECTS.map(s => ({ value: s, label: s }))]}
          />
          <RangePicker
            value={range as any}
            onChange={(v) => setRange((v || [dayjs().subtract(29, 'day'), dayjs()]) as any)}
            allowClear={false}
          />
          <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>刷新</Button>
          <Button icon={<FileTextOutlined />} onClick={() => { setHistoryOpen(true); loadHistory(); }}>
            报告历史
          </Button>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={aiLoading}
            onClick={handleGenerateAi}
            disabled={!overview || (overview?.kpi?.total_answers || 0) === 0}
          >
            AI 生成班级学情报告
          </Button>
        </Space>
        {overview && (
          <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
            统计区间 {overview.range?.start} ~ {overview.range?.end}
            {overview.role === 'subject_teacher' && `　·　任课老师视角（仅含你所授学科：${(overview.subjects || []).join('、') || '无'}）`}
          </div>
        )}
      </Card>

      <Spin spinning={loading}>
        {/* KPI */}
        {kpi && (
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={4}><Card size="small"><Statistic title="统计区间作答" value={kpi.total_answers} suffix="题" /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="平均正确率" value={kpi.accuracy} suffix="%" valueStyle={{ color: kpi.accuracy >= 80 ? '#52c41a' : kpi.accuracy >= 60 ? '#1890ff' : '#ff4d4f' }} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="参与学生" value={kpi.active_students} suffix={`/ ${kpi.student_count}`} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="参与率" value={kpi.participation} suffix="%" /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="作业份数" value={kpi.assignment_count} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="班均分" value={kpi.average_score} /></Card></Col>
          </Row>
        )}

        {kpi && kpi.total_answers === 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="所选区间内没有作答数据"
            description="请放宽时间范围或更换学科。若学生是走纸质卷流程，请确认老师已在「批量扫描」中完成登记——纸质作答同样计入学情。"
          />
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'overview',
              label: '总览',
              children: (
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="每日正确率趋势">
                      <TrendLine data={dailyData} />
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="各学科正确率对比">
                      {subjectData.length > 0
                        ? <DistributionPie data={subjectData} height={260} />
                        : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="作业类型分布（作答量）">
                      <CountColumn data={typeData} unit=" 题" />
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="作业完成情况">
                      <Table
                        size="small"
                        rowKey="id"
                        pagination={false}
                        dataSource={overview?.assignments || []}
                        columns={[
                          { title: '作业', dataIndex: 'title', ellipsis: true },
                          {
                            title: '类型', dataIndex: 'assignment_type', width: 70,
                            render: (v: string) => (
                              <Tag color={v === 'preview' ? 'purple' : v === 'review' ? 'orange' : 'blue'}>
                                {{ preview: '预习', homework: '作业', review: '复习' }[v] || '作业'}
                              </Tag>
                            ),
                          },
                          { title: '提交', dataIndex: 'submitted_count', width: 90, render: (v: number, r: any) => `${v}/${r.total_students}` },
                          {
                            title: '完成率', dataIndex: 'completion_rate', width: 80,
                            render: (v: number) => <Tag color={v >= 90 ? 'green' : v >= 60 ? 'blue' : 'red'}>{v}%</Tag>,
                          },
                          { title: '均分', dataIndex: 'avg_score', width: 70, render: (v: number) => (v ?? '—') },
                        ]}
                      />
                    </Card>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'matrix',
              label: '知识点掌握矩阵',
              children: matrix?.knowledge_points?.length ? (
                <Card
                  size="small"
                  title="学生 × 知识点 正确率"
                  extra={
                    <Space>
                      <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportMatrix('xlsx')}>导出 Excel</Button>
                      <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportMatrix('csv')}>CSV</Button>
                    </Space>
                  }
                >
                  <Alert
                    type="info"
                    style={{ marginBottom: 12 }}
                    message="空白格表示该生在该知识点上还没有练习记录"
                    description="绿色≥80%（已掌握）　黄色60-79%（一般）　红色<60%（薄弱）"
                  />
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={cellStyle('#fafafa', 60, 90)}>姓名</th>
                          {matrix.knowledge_points.map((k: any) => (
                            <th key={k.knowledge_point} style={cellStyle('#fafafa', 110, 60)}>
                              <Tooltip title={`全班练习 ${k.attempts} 题，正确率 ${k.accuracy}%`}>
                                <span>{k.knowledge_point}</span>
                              </Tooltip>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.matrix.map((row: any) => (
                          <tr key={row.user_id}>
                            <td style={cellStyle('#fafafa', 90, 60)}>
                              <a onClick={() => openStudentDetail(row.user_id)}>{row.real_name || row.username}</a>
                            </td>
                            {matrix.knowledge_points.map((k: any) => {
                              const c = row.points[k.knowledge_point];
                              return (
                                <td
                                  key={k.knowledge_point}
                                  style={{
                                    background: c ? (c.accuracy >= 80 ? '#b7eb8f' : c.accuracy >= 60 ? '#fff2a8' : '#ffa39e') : '#fafafa',
                                    border: '1px solid #fff', padding: 6, textAlign: 'center',
                                  }}
                                >
                                  {c ? `${c.accuracy}%` : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : <Empty description="暂无知识点数据（题目需要标注知识点才会纳入统计）" />,
            },
            {
              key: 'students',
              label: '学生名单',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                  {studentList?.need_attention?.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`有 ${studentList.need_attention.length} 名学生需要关注`}
                      description={
                        <div style={{ marginTop: 4 }}>
                          {studentList.need_attention.map((s: any) => (
                            <Tag
                              key={s.user_id}
                              style={{ marginBottom: 4, cursor: 'pointer' }}
                              color={s.attempts === 0 ? 'default' : 'orange'}
                              onClick={() => openStudentDetail(s.user_id)}
                            >
                              {s.real_name || s.username}
                              {s.attempts === 0 ? '（无作答）' : `（正确率${s.accuracy}%）`}
                              {s.wrong_unreviewed >= 10 ? ` 错题${s.wrong_unreviewed}道` : ''}
                            </Tag>
                          ))}
                        </div>
                      }
                    />
                  )}
                  <Card
                    size="small"
                    extra={
                      <Space>
                        <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportStudents('xlsx')}>导出 Excel</Button>
                        <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportStudents('csv')}>CSV</Button>
                      </Space>
                    }
                  >
                    <Table
                      size="small"
                      rowKey="user_id"
                      dataSource={studentList?.students || []}
                      columns={studentColumns}
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      scroll={{ x: 900 }}
                    />
                  </Card>
                </Space>
              ),
            },
            {
              key: 'ai',
              label: 'AI 分析报告',
              children: aiReport ? (
                <Card
                  size="small"
                  title="AI 班级学情分析"
                  extra={
                    <Space>
                      <Button size="small" icon={<RobotOutlined />} loading={aiLoading} onClick={handleGenerateAi}>重新生成</Button>
                      <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportReport()}>导出</Button>
                    </Space>
                  }
                >
                  {aiMeta && (
                    <div style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
                      模型 {aiMeta.model}　区间 {aiMeta.range?.start} ~ {aiMeta.range?.end}
                    </div>
                  )}
                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    <Col span={6}><Statistic title="综合得分" value={aiReport.overall_score ?? '—'} suffix={aiReport.level ? `（${aiReport.level}）` : ''} /></Col>
                  </Row>
                  <Alert type="success" message={aiReport.summary} style={{ marginBottom: 12 }} />
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Card size="small" type="inner" title="优势" style={{ marginBottom: 12 }}>
                        <List size="small" dataSource={aiReport.strengths || []} renderItem={(s: string) => <List.Item><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />{s}</List.Item>} />
                      </Card>
                      <Card size="small" type="inner" title="主要问题">
                        <List size="small" dataSource={aiReport.weaknesses || []} renderItem={(s: string) => <List.Item><WarningOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />{s}</List.Item>} />
                      </Card>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card size="small" type="inner" title="成因分析" style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 13, lineHeight: 1.7 }}>{aiReport.root_cause_analysis}</div>
                      </Card>
                      {aiReport.parent_communication && (
                        <Card size="small" type="inner" title="家长沟通建议">
                          <div style={{ fontSize: 13, lineHeight: 1.7 }}>{aiReport.parent_communication}</div>
                        </Card>
                      )}
                    </Col>
                  </Row>
                  {aiReport.teaching_suggestions?.length > 0 && (
                    <Card size="small" type="inner" title="教学建议" style={{ marginTop: 12 }}>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="action"
                        dataSource={aiReport.teaching_suggestions}
                        columns={[
                          { title: '优先级', dataIndex: 'priority', width: 80, render: (p: string) => <Tag color={p === '高' ? 'red' : p === '中' ? 'orange' : 'default'}>{p}</Tag> },
                          { title: '建议', dataIndex: 'action' },
                          { title: '预期效果', dataIndex: 'expected_effect' },
                        ]}
                      />
                    </Card>
                  )}
                  {aiReport.focus_students?.length > 0 && (
                    <Card size="small" type="inner" title="需重点关注的学生" style={{ marginTop: 12 }}>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="name"
                        dataSource={aiReport.focus_students}
                        columns={[
                          { title: '姓名', dataIndex: 'name', width: 100 },
                          { title: '问题表现', dataIndex: 'reason' },
                          { title: '建议', dataIndex: 'suggestion' },
                        ]}
                      />
                    </Card>
                  )}
                </Card>
              ) : (
                <Card size="small">
                  <Empty description="尚未生成 AI 报告">
                    <Button type="primary" icon={<RobotOutlined />} loading={aiLoading} onClick={handleGenerateAi}>
                      生成班级学情报告
                    </Button>
                  </Empty>
                </Card>
              ),
            },
          ]}
        />
      </Spin>

      {/* 学生画像抽屉 */}
      <Drawer
        title={detail?.student ? `${detail.student.real_name || detail.student.username} · 学情画像` : '学情画像'}
        width={Math.min(860, typeof window !== 'undefined' ? window.innerWidth - 40 : 860)}
        open={!!detail}
        onClose={() => { setDetail(null); setStuAiReport(null); }}
        extra={
          detail?.student && (
            <Button
              type="primary"
              size="small"
              icon={<RobotOutlined />}
              loading={stuAiLoading}
              onClick={() => handleGenerateStudentAi(detail.student.id)}
            >
              AI 生成个体报告
            </Button>
          )
        }
      >
        <Spin spinning={detailLoading}>
          {detail && !detail.loading && (
            <>
              <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="统计区间">{detail.range?.start} ~ {detail.range?.end}</Descriptions.Item>
                <Descriptions.Item label="作答总数">{detail.overall?.attempts} 题</Descriptions.Item>
                <Descriptions.Item label="正确率">
                  <Tag color={detail.overall?.accuracy >= 80 ? 'green' : detail.overall?.accuracy >= 60 ? 'blue' : 'red'}>
                    {detail.overall?.accuracy}%
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="掌握度">
                  <Tag color={MASTERY_META[detail.overall?.mastery]?.color}>{MASTERY_META[detail.overall?.mastery]?.text}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="薄弱知识点">{detail.overall?.weak_knowledge_count} 个</Descriptions.Item>
                <Descriptions.Item label="待复习错题">{detail.overall?.wrong_pending} 题</Descriptions.Item>
              </Descriptions>

              {stuAiReport && (
                <Card size="small" type="inner" title="AI 个体分析（教师视角）" style={{ marginBottom: 16 }}>
                  <Alert type="success" message={stuAiReport.summary} style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <strong>水平：</strong>{stuAiReport.level}
                  </div>
                  {stuAiReport.weaknesses?.length > 0 && (
                    <div style={{ fontSize: 13 }}>
                      <strong>主要问题：</strong>
                      <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>
                        {stuAiReport.weaknesses.map((w: string, i: number) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {stuAiReport.knowledge_gaps?.length > 0 && (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="knowledge_point"
                      dataSource={stuAiReport.knowledge_gaps}
                      columns={[
                        { title: '知识点', dataIndex: 'knowledge_point', width: 110 },
                        { title: '表现证据', dataIndex: 'evidence' },
                        { title: '补救措施', dataIndex: 'action' },
                      ]}
                    />
                  )}
                  {stuAiReport.study_habits && (
                    <div style={{ fontSize: 13, marginTop: 10 }}>
                      <strong>学习习惯：</strong>{stuAiReport.study_habits}
                    </div>
                  )}
                  {stuAiReport.tutoring_plan?.length > 0 && (
                    <>
                      <Divider orientation="left" style={{ fontSize: 13 }}>辅导计划</Divider>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="step"
                        dataSource={stuAiReport.tutoring_plan}
                        columns={[
                          { title: '步骤', dataIndex: 'step', width: 60 },
                          { title: '动作', dataIndex: 'action' },
                          { title: '配套练习', dataIndex: 'resource' },
                        ]}
                      />
                    </>
                  )}
                  {stuAiReport.communicate_with_parent && (
                    <Alert
                      type="info"
                      style={{ marginTop: 12 }}
                      message="给家长的建议"
                      description={stuAiReport.communicate_with_parent}
                    />
                  )}
                </Card>
              )}

              <Row gutter={[12, 12]}>
                <Col xs={24}>
                  <Card size="small" title="每日正确率">
                    <TrendLine data={(detail.daily || []).map((d: any) => ({ date: d.date, value: d.accuracy }))} height={200} />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="各学科正确率">
                    <AccuracyColumn
                      data={(detail.by_subject || []).map((s: any) => ({ name: s.subject, accuracy: s.accuracy }))}
                      height={220}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="作业得分趋势">
                    {detail.score_trend?.length ? (
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="assignment_id"
                        dataSource={detail.score_trend}
                        columns={[
                          { title: '作业', dataIndex: 'title', ellipsis: true },
                          { title: '得分', dataIndex: 'best_score', width: 70 },
                        ]}
                      />
                    ) : <Empty description="无作业记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>
                </Col>
                <Col xs={24}>
                  <Card size="small" title={`知识点掌握（${detail.knowledge_points?.length || 0}）`}>
                    <Table
                      size="small"
                      rowKey="knowledge_point"
                      dataSource={detail.knowledge_points || []}
                      pagination={{ pageSize: 8 }}
                      columns={[
                        { title: '知识点', dataIndex: 'knowledge_point' },
                        { title: '练习', dataIndex: 'attempts', width: 70 },
                        {
                          title: '正确率', dataIndex: 'accuracy', width: 130,
                          render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 80 ? '#52c41a' : v >= 60 ? '#1890ff' : '#ff4d4f'} />,
                        },
                        {
                          title: '掌握度', dataIndex: 'mastery', width: 90,
                          render: (v: string) => <Tag color={MASTERY_META[v]?.color}>{MASTERY_META[v]?.text}</Tag>,
                        },
                      ]}
                    />
                  </Card>
                </Col>
                <Col xs={24}>
                  <Card size="small" title={`错题（${detail.wrong_questions?.length || 0}）`}>
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={detail.wrong_questions || []}
                      pagination={{ pageSize: 5 }}
                      columns={[
                        { title: '知识点', dataIndex: 'knowledge_point', width: 130, render: (v: string) => v || '—' },
                        { title: '题目', dataIndex: 'content', ellipsis: true },
                        { title: '错次', dataIndex: 'wrong_count', width: 60, render: (v: number) => <Tag color={v > 1 ? 'red' : 'default'}>{v}</Tag> },
                        {
                          title: '复习', dataIndex: 'reviewed', width: 70,
                          render: (v: number) => (v ? <Tag color="green">已复习</Tag> : <Tag color="orange">待复习</Tag>),
                        },
                      ]}
                    />
                  </Card>
                </Col>
              </Row>
            </>
          )}
        </Spin>
      </Drawer>

      {/* 报告历史 */}
      <Drawer
        title="AI 报告历史"
        width={520}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadHistory} loading={historyLoading}><HistoryOutlined /></Button>}
      >
        <Spin spinning={historyLoading}>
          {history.length === 0 ? (
            <Empty description="还没有生成过报告" />
          ) : (
            <List
              dataSource={history}
              renderItem={(r: any) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={async () => {
                    try {
                      const res = await learningReportAPI.getAiReport(r.id);
                      if (r.report_type === 'class') {
                        setAiReport(res.data.content);
                        setAiMeta({ model: res.data.model, range: { start: res.data.period_start, end: res.data.period_end }, subject: res.data.subject });
                        setActiveTab('ai');
                      }
                      message.success('已载入报告');
                    } catch (e) {
                      message.error('载入失败');
                    }
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={r.report_type === 'class' ? 'blue' : 'purple'}>
                          {r.report_type === 'class' ? '班级' : `学生·${r.target_name || ''}`}
                        </Tag>
                        {r.subject ? <Tag>{r.subject}</Tag> : <Tag color="default">全部学科</Tag>}
                        <span style={{ fontSize: 12, color: '#999' }}>{r.period_start} ~ {r.period_end}</span>
                      </Space>
                    }
                    description={
                      <>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>{r.summary || '（无摘要）'}</div>
                        <div style={{ fontSize: 11, color: '#bbb' }}>
                          {r.generated_by_name || '未知'} 生成于 {dayjs(r.created_at).format('YYYY-MM-DD HH:mm')}
                        </div>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Drawer>
    </div>
  );
};

/** 单元格样式（表格用） */
function cellStyle(bg: string, minWidth: number, height: number) {
  return {
    background: bg,
    border: '1px solid #fff',
    padding: 6,
    minWidth,
    height,
    fontSize: 12,
  } as React.CSSProperties;
}

export default LearningReports;
