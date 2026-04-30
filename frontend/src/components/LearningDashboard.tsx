import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Select, Empty, Spin, Alert, Button, message, Collapse, Divider } from 'antd';
import {
  BookOutlined,
  TrophyOutlined,
  RiseOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  RobotOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { aiCoachAPI, knowledgePointAPI } from '../utils/api';
import { MasteryRing, AccuracyColumn, CountColumn, WeakPointBar, LearningHeatmap, TrendLine } from './charts/ChartKit';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface KnowledgePointStat {
  knowledge_point: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
}

interface KnowledgePointData {
  days: number;
  start_date: string;
  stats: KnowledgePointStat[];
  total_points: number;
  avg_accuracy: number;
}

interface WeakPointData {
  weak_points: KnowledgePointStat[];
  count: number;
  days: number;
  threshold: number;
}

const LearningDashboard: React.FC = () => {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [kpData, setKpData] = useState<KnowledgePointData | null>(null);
  const [weakPoints, setWeakPoints] = useState<WeakPointData | null>(null);
  const [aiPlan, setAiPlan] = useState<any>(null);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanGeneratedAt, setAiPlanGeneratedAt] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [diagnosisContext, setDiagnosisContext] = useState<any>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisGeneratedAt, setDiagnosisGeneratedAt] = useState<string | null>(null);
  const [reviewEffect, setReviewEffect] = useState<any>(null);
  const [reviewEffectLoading, setReviewEffectLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [learningTime, setLearningTime] = useState<any>(null);
  const [learningTimeLoading, setLearningTimeLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [days]);

  useEffect(() => {
    loadReviewEffect();
  }, []);

  useEffect(() => {
    loadLearningTime();
  }, [days]);

  const loadLearningTime = async () => {
    try {
      setLearningTimeLoading(true);
      const res = await knowledgePointAPI.getLearningTime({ days });
      setLearningTime(res.data);
    } catch (e) {
      // 静默失败
    } finally {
      setLearningTimeLoading(false);
    }
  };

  const loadReviewEffect = async () => {
    try {
      setReviewEffectLoading(true);
      const res = await knowledgePointAPI.getReviewEffectiveness({ recent_days: 7, base_days: 14 });
      setReviewEffect(res.data);
    } catch (e) {
      // 静默失败
    } finally {
      setReviewEffectLoading(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      // 加载知识点统计
      const [kpRes, weakRes, heatmapRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/knowledge-points?days=${days}`, { headers }),
        axios.get(`${API_BASE_URL}/knowledge-points/weak-points?days=${days}`, { headers }),
        axios.get(`${API_BASE_URL}/knowledge-points/heatmap?days=${Math.max(days, 30)}`, { headers })
      ]);

      setKpData(kpRes.data);
      setWeakPoints(weakRes.data);

      // 构建热力图数据：{date, knowledge_point, value}
      const hm: any[] = [];
      const { dates = [], matrix = [] } = heatmapRes.data || {};
      for (const row of matrix) {
        for (const d of dates) {
          const cell = row[d];
          hm.push({
            date: d,
            knowledge_point: row.knowledge_point,
            value: cell ? cell.attempts : 0
          });
        }
      }
      setHeatmapData(hm);

      // 构建趋势数据：按日聚合正确率
      const dailyAgg: Record<string, { total: number; correct: number }> = {};
      for (const row of matrix) {
        for (const d of dates) {
          const cell = row[d];
          if (!cell) continue;
          if (!dailyAgg[d]) dailyAgg[d] = { total: 0, correct: 0 };
          dailyAgg[d].total += (cell.attempts || 0);
          dailyAgg[d].correct += Math.round(((cell.attempts || 0) * (cell.accuracy || 0)) / 100);
        }
      }
      const trend = Object.keys(dailyAgg).sort().map(d => {
        const { total, correct } = dailyAgg[d];
        return { date: d, value: total > 0 ? Math.round((correct / total) * 100) : 0, category: '正确率' };
      });
      setTrendData(trend);
    } catch (error: any) {
      console.error('加载学习数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 90) return '#52c41a';
    if (accuracy >= 70) return '#faad14';
    if (accuracy >= 60) return '#fa8c16';
    return '#f5222d';
  };

  const loadAIPlan = async () => {
    try {
      setAiPlanLoading(true);
      const res = await aiCoachAPI.getLearningPlan({ days: 14 });
      if (res.data.empty) {
        message.info(res.data.message || '暂无数据生成规划');
        setAiPlan(null);
      } else {
        setAiPlan(res.data.plan);
        setAiPlanGeneratedAt(res.data.generated_at);
        message.success('AI学习规划已生成');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '生成学习规划失败');
    } finally {
      setAiPlanLoading(false);
    }
  };

  const loadDiagnosis = async () => {
    try {
      setDiagnosisLoading(true);
      const res = await aiCoachAPI.getDiagnosis({ days: 30 });
      if (res.data.empty) {
        message.info(res.data.message || '暂无数据生成诊断报告');
        setDiagnosis(null);
      } else {
        setDiagnosis(res.data.report);
        setDiagnosisContext(res.data.context);
        setDiagnosisGeneratedAt(res.data.generated_at);
        message.success('AI诊断报告已生成');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '生成诊断报告失败');
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const getAccuracyStatus = (accuracy: number) => {
    if (accuracy >= 90) return '优秀';
    if (accuracy >= 70) return '良好';
    if (accuracy >= 60) return '及格';
    return '需加强';
  };

  const columns = [
    {
      title: '知识点',
      dataIndex: 'knowledge_point',
      key: 'knowledge_point',
      render: (text: string) => (
        <span style={{ fontWeight: 500 }}>
          <BookOutlined style={{ marginRight: 8, color: '#1890ff' }} />
          {text}
        </span>
      )
    },
    {
      title: '练习次数',
      dataIndex: 'total_attempts',
      key: 'total_attempts',
      sorter: (a: KnowledgePointStat, b: KnowledgePointStat) => a.total_attempts - b.total_attempts,
      render: (count: number) => (
        <Tag color="blue">{count} 次</Tag>
      )
    },
    {
      title: '正确次数',
      dataIndex: 'correct_attempts',
      key: 'correct_attempts',
      render: (correct: number, record: KnowledgePointStat) => (
        <span>
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
          {correct} / {record.total_attempts}
        </span>
      )
    },
    {
      title: '正确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      sorter: (a: KnowledgePointStat, b: KnowledgePointStat) => a.accuracy - b.accuracy,
      render: (accuracy: number) => (
        <div>
          <Progress
            percent={accuracy}
            size="small"
            strokeColor={getAccuracyColor(accuracy)}
            format={() => `${accuracy}%`}
          />
        </div>
      )
    },
    {
      title: '掌握程度',
      key: 'level',
      render: (_: any, record: KnowledgePointStat) => (
        <Tag color={getAccuracyColor(record.accuracy)}>
          {getAccuracyStatus(record.accuracy)}
        </Tag>
      )
    }
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#999' }}>加载学习数据中...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <RiseOutlined style={{ color: '#52c41a', fontSize: 28 }} />
            学习数据仪表盘
          </h2>
          <p style={{ color: '#666', margin: '8px 0 0' }}>
            查看你的学习进度和知识点掌握情况
          </p>
        </div>
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 150 }}
          options={[
            { label: '最近7天', value: 7 },
            { label: '最近14天', value: 14 },
            { label: '最近30天', value: 30 }
          ]}
        />
      </div>

      {!kpData || kpData.stats.length === 0 ? (
        <Empty
          description="暂无学习数据，开始做题吧！"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <>
          {/* 统计卡片 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="知识点总数"
                  value={kpData.total_points}
                  suffix="个"
                  prefix={<BookOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="平均正确率"
                  value={kpData.avg_accuracy}
                  suffix="%"
                  precision={2}
                  prefix={<TrophyOutlined />}
                  valueStyle={{ color: getAccuracyColor(kpData.avg_accuracy) }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="薄弱知识点"
                  value={weakPoints?.count || 0}
                  suffix="个"
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: (weakPoints?.count || 0) > 0 ? '#f5222d' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="统计周期"
                  value={days}
                  suffix="天"
                  prefix={<RiseOutlined />}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
          </Row>

          {/* 薄弱知识点警告 */}
          {weakPoints && weakPoints.count > 0 && (
            <Alert
              type="warning"
              message={
                <span>
                  <WarningOutlined style={{ marginRight: 8 }} />
                  发现 {weakPoints.count} 个薄弱知识点，需要重点复习！
                </span>
              }
              description={
                <div style={{ marginTop: 8 }}>
                  {weakPoints.weak_points.slice(0, 3).map((wp, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      • <strong>{wp.knowledge_point}</strong>: 正确率 {wp.accuracy}% 
                      ({wp.correct_attempts}/{wp.total_attempts})
                    </div>
                  ))}
                  {weakPoints.count > 3 && (
                    <div style={{ color: '#999', marginTop: 4 }}>
                      还有 {weakPoints.count - 3} 个薄弱知识点...
                    </div>
                  )}
                </div>
              }
              showIcon={false}
              style={{ marginBottom: 16 }}
            />
          )}

          {/* 图形化分析 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}>
              <Card size="small" title="整体掌握率">
                <MasteryRing
                  percent={Number(kpData.avg_accuracy) || 0}
                  label={`平均正确率 · 最近${days}天`}
                  color={getAccuracyColor(Number(kpData.avg_accuracy) || 0)}
                />
              </Card>
            </Col>
            <Col xs={24} md={16}>
              <Card size="small" title="知识点正确率分布">
                <AccuracyColumn
                  data={(kpData.stats || []).slice(0, 10).map(s => ({
                    name: s.knowledge_point.length > 8 ? s.knowledge_point.slice(0, 8) + '…' : s.knowledge_point,
                    accuracy: s.accuracy
                  }))}
                  height={260}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Card size="small" title="近期正确率趋势">
                <TrendLine data={trendData} height={260} />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title="薄弱知识点排行">
                <WeakPointBar
                  data={(weakPoints?.weak_points || []).slice(0, 8).map(w => ({
                    name: w.knowledge_point.length > 10 ? w.knowledge_point.slice(0, 10) + '…' : w.knowledge_point,
                    accuracy: w.accuracy
                  }))}
                  height={260}
                />
              </Card>
            </Col>
          </Row>

          <Card size="small" title="知识点·日期 练习热力图" style={{ marginBottom: 16 }}>
            <LearningHeatmap data={heatmapData} height={320} />
          </Card>

          {/* 知识点详细表格 */}
          <Card title="知识点掌握情况" size="small">
            <Table
              dataSource={kpData.stats}
              columns={columns}
              rowKey="knowledge_point"
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>

          {/* AI学习规划 */}
          <Card
            size="small"
            style={{ marginTop: 16, borderColor: '#722ed1' }}
            title={<span><RobotOutlined style={{ color: '#722ed1', marginRight: 6 }} />AI 个性化学习规划</span>}
            extra={
              <Button
                type="primary"
                size="small"
                loading={aiPlanLoading}
                icon={aiPlan ? <ReloadOutlined /> : <ScheduleOutlined />}
                onClick={loadAIPlan}
              >
                {aiPlan ? '重新生成' : '生成为我定制的规划'}
              </Button>
            }
          >
            {!aiPlan ? (
              <div style={{ color: '#999', padding: '12px 0' }}>
                🤖 点击右上按钮，AI 会基于你的错题本、薄弱知识点、答题记录为你制定未来7天的学习规划。
              </div>
            ) : (
              <div>
                {aiPlanGeneratedAt && (
                  <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                    生成时间: {new Date(aiPlanGeneratedAt).toLocaleString()}
                  </div>
                )}
                {aiPlan.overview && (
                  <Alert type="info" showIcon message={aiPlan.overview} style={{ marginBottom: 12 }} />
                )}
                {Array.isArray(aiPlan.priority_goals) && aiPlan.priority_goals.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong>🎯 核心目标：</strong>
                    <div style={{ marginTop: 6 }}>
                      {aiPlan.priority_goals.map((g: string, i: number) => (
                        <Tag color="purple" key={i} style={{ marginBottom: 4 }}>{g}</Tag>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(aiPlan.daily_plan) && aiPlan.daily_plan.length > 0 && (
                  <Collapse
                    size="small"
                    defaultActiveKey={['1']}
                    items={aiPlan.daily_plan.map((d: any) => ({
                      key: String(d.day),
                      label: (
                        <span>
                          <Tag color="blue">Day {d.day}</Tag>
                          <strong>{d.theme}</strong>
                          {d.estimated_minutes && <Tag style={{ marginLeft: 6 }}>{d.estimated_minutes}分钟</Tag>}
                        </span>
                      ),
                      children: (
                        <div>
                          {Array.isArray(d.focus_points) && d.focus_points.length > 0 && (
                            <div style={{ marginBottom: 6 }}>
                              <strong>重点知识点：</strong>
                              {d.focus_points.map((p: string, i: number) => (
                                <Tag color="cyan" key={i}>{p}</Tag>
                              ))}
                            </div>
                          )}
                          {Array.isArray(d.tasks) && d.tasks.length > 0 && (
                            <ul style={{ paddingLeft: 20, margin: 0 }}>
                              {d.tasks.map((t: string, i: number) => <li key={i}>{t}</li>)}
                            </ul>
                          )}
                        </div>
                      )
                    }))}
                  />
                )}
                {aiPlan.weekly_milestone && (
                  <div style={{ marginTop: 12, padding: 10, background: '#f9f0ff', borderRadius: 4 }}>
                    <strong>🏁 周末里程碑：</strong>{aiPlan.weekly_milestone}
                  </div>
                )}
                {aiPlan.encouragement && (
                  <div style={{ marginTop: 10, padding: 10, background: '#fff7e6', borderRadius: 4, fontStyle: 'italic', color: '#873800' }}>
                    💬 {aiPlan.encouragement}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* 复习效果监测 */}
          <Card
            size="small"
            style={{ marginTop: 16, borderColor: '#13c2c2' }}
            title={<span><CheckCircleOutlined style={{ color: '#13c2c2', marginRight: 6 }} />复习效果监测</span>}
            extra={<Button size="small" loading={reviewEffectLoading} onClick={loadReviewEffect}>刷新</Button>}
          >
            {!reviewEffect || !reviewEffect.items || reviewEffect.items.length === 0 ? (
              <Empty description="暂无足够的历史数据比对，多练几天再来看看吧" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div>
                <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                  <Col xs={12} md={6}>
                    <Card size="small"><Statistic title="追踪知识点" value={reviewEffect.summary.total_tracked} suffix="个" /></Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small"><Statistic title="明显提升" value={reviewEffect.summary.improving} suffix="个" valueStyle={{ color: '#52c41a' }} /></Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small"><Statistic title="已巩固" value={reviewEffect.summary.consolidated} suffix="个" valueStyle={{ color: '#1677ff' }} /></Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small"><Statistic title="出现下滑" value={reviewEffect.summary.declining} suffix="个" valueStyle={{ color: '#f5222d' }} /></Card>
                  </Col>
                </Row>
                <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                  对比区间：{reviewEffect.base_period?.start} ~ {reviewEffect.base_period?.end}（前期） vs {reviewEffect.recent_period?.start} 至今（近期）
                </div>
                <Table
                  size="small"
                  dataSource={reviewEffect.items.slice(0, 10)}
                  rowKey="knowledge_point"
                  pagination={false}
                  columns={[
                    {
                      title: '知识点',
                      dataIndex: 'knowledge_point',
                      render: (t: string, r: any) => (
                        <span>
                          {r.was_weak && <Tag color="red">原薄弱</Tag>}
                          {t}
                        </span>
                      )
                    },
                    { title: '前期正确率', dataIndex: 'base_accuracy', render: (v: number) => `${v}%`, width: 100 },
                    {
                      title: '近期正确率', dataIndex: 'recent_accuracy', width: 100,
                      render: (v: number | null) => v === null ? <Tag>未练</Tag> : `${v}%`
                    },
                    {
                      title: '变化', dataIndex: 'delta', width: 100,
                      render: (d: number | null) => {
                        if (d === null) return '-';
                        if (d > 0) return <span style={{ color: '#52c41a' }}>↑ +{d}%</span>;
                        if (d < 0) return <span style={{ color: '#f5222d' }}>↓ {d}%</span>;
                        return <span>↔ 0%</span>;
                      }
                    },
                    {
                      title: '状态', dataIndex: 'status', width: 100,
                      render: (s: string, r: any) => {
                        const colorMap: Record<string, string> = { improving: 'green', declining: 'red', consolidated: 'blue', stable: 'default', no_data: 'orange' };
                        return <Tag color={colorMap[s] || 'default'}>{r.status_label}</Tag>;
                      }
                    }
                  ]}
                />
                {reviewEffect.summary.weak_not_reviewed > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 10 }}
                    message={`有 ${reviewEffect.summary.weak_not_reviewed} 个原本薄弱的知识点最近未复习，建议尽快排入学习计划。`}
                  />
                )}
              </div>
            )}
          </Card>

          {/* AI诊断报告 */}
          <Card
            size="small"
            style={{ marginTop: 16, borderColor: '#eb2f96' }}
            title={<span><RobotOutlined style={{ color: '#eb2f96', marginRight: 6 }} />AI 学情诊断报告</span>}
            extra={
              <Button
                type="primary"
                danger
                size="small"
                loading={diagnosisLoading}
                icon={<RobotOutlined />}
                onClick={loadDiagnosis}
              >
                {diagnosis ? '重新诊断' : '生成诊断报告'}
              </Button>
            }
          >
            {!diagnosis ? (
              <div style={{ color: '#999', padding: '12px 0' }}>
                🩺 点击右上按钮，AI 将分析你最近30天的答题表现、薄弱点分布和错题轨迹，生成一份学情诊断报告，并给出有针对性的改进建议。
              </div>
            ) : (
              <div>
                {diagnosisGeneratedAt && (
                  <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                    生成时间: {new Date(diagnosisGeneratedAt).toLocaleString()}
                  </div>
                )}
                <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                  <Col xs={12} md={6}>
                    <Card size="small">
                      <Statistic
                        title="综合得分"
                        value={diagnosis.overall_score}
                        suffix="/100"
                        valueStyle={{ color: getAccuracyColor(diagnosis.overall_score) }}
                      />
                    </Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small">
                      <Statistic title="水平评定" value={diagnosis.level || '-'} />
                    </Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small">
                      <Statistic title="平均正确率" value={diagnosisContext?.overall_accuracy || 0} suffix="%" />
                    </Card>
                  </Col>
                  <Col xs={12} md={6}>
                    <Card size="small">
                      <Statistic title="薄弱点数" value={diagnosisContext?.weak_point_count || 0} suffix="个" />
                    </Card>
                  </Col>
                </Row>
                {Array.isArray(diagnosis.strengths) && diagnosis.strengths.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <strong style={{ color: '#52c41a' }}>✨ 优势：</strong>
                    {diagnosis.strengths.map((s: string, i: number) => (
                      <Tag color="green" key={i} style={{ marginBottom: 4 }}>{s}</Tag>
                    ))}
                  </div>
                )}
                {Array.isArray(diagnosis.weaknesses) && diagnosis.weaknesses.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <strong style={{ color: '#f5222d' }}>⚠️ 问题：</strong>
                    {diagnosis.weaknesses.map((s: string, i: number) => (
                      <Tag color="red" key={i} style={{ marginBottom: 4 }}>{s}</Tag>
                    ))}
                  </div>
                )}
                {diagnosis.root_cause_analysis && (
                  <Alert
                    type="warning"
                    showIcon
                    message="深层成因分析"
                    description={diagnosis.root_cause_analysis}
                    style={{ marginBottom: 10 }}
                  />
                )}
                {Array.isArray(diagnosis.recommendations) && diagnosis.recommendations.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <Divider orientation="left" plain style={{ margin: '8px 0' }}>改进建议</Divider>
                    {diagnosis.recommendations.map((r: any, i: number) => (
                      <Card key={i} size="small" style={{ marginBottom: 6, background: '#fafafa' }}>
                        <div>
                          <Tag color={r.priority === '高' ? 'red' : r.priority === '中' ? 'orange' : 'blue'}>优先级：{r.priority}</Tag>
                          <strong>{r.action}</strong>
                        </div>
                        {r.expected_effect && (
                          <div style={{ marginTop: 4, color: '#666', fontSize: 13 }}>
                            🎯 预期效果：{r.expected_effect}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
                {Array.isArray(diagnosis.next_focus_points) && diagnosis.next_focus_points.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <strong>🔍 下阶段重点：</strong>
                    {diagnosis.next_focus_points.map((p: string, i: number) => (
                      <Tag color="cyan" key={i}>{p}</Tag>
                    ))}
                  </div>
                )}
                {diagnosis.summary && (
                  <div style={{ marginTop: 10, padding: 10, background: '#fff0f6', borderRadius: 4, fontStyle: 'italic', color: '#9e1068' }}>
                    📝 {diagnosis.summary}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* 学习时间分析 */}
          <Card
            title="⏰ 学习时间分析"
            size="small"
            style={{ marginTop: 16 }}
            loading={learningTimeLoading}
          >
            {learningTime && learningTime.summary && learningTime.summary.total_answers > 0 ? (
              <>
                <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                  <Col xs={12} sm={6}>
                    <Statistic title="总答题数" value={learningTime.summary.total_answers} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="活跃天数" value={learningTime.summary.active_days} suffix={`/ ${learningTime.days}`} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="日均答题" value={learningTime.summary.avg_per_day} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic
                      title="活跃时段"
                      value={learningTime.summary.peak_hour || '-'}
                      suffix={learningTime.summary.peak_weekday ? `· ${learningTime.summary.peak_weekday}` : ''}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                </Row>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12}>
                    <div style={{ fontWeight: 500, marginBottom: 4, color: '#666' }}>📈 每日答题趋势</div>
                    <CountColumn
                      data={(learningTime.daily || []).map((d: any) => ({ name: d.date?.slice(5), value: d.answers }))}
                      unit="题"
                      color="#1677ff"
                      height={220}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <div style={{ fontWeight: 500, marginBottom: 4, color: '#666' }}>📅 周内分布</div>
                    <CountColumn
                      data={(learningTime.weekday || []).map((w: any) => ({ name: w.weekday, value: w.answers }))}
                      unit="题"
                      color="#52c41a"
                      height={220}
                    />
                  </Col>
                  <Col xs={24}>
                    <div style={{ fontWeight: 500, marginBottom: 4, color: '#666' }}>⏱️ 一天内活跃时段分布</div>
                    <CountColumn
                      data={(learningTime.hourly || []).map((h: any) => ({ name: h.hour, value: h.answers }))}
                      unit="题"
                      color="#fa8c16"
                      height={220}
                    />
                  </Col>
                </Row>
                <div style={{ marginTop: 12, padding: 10, background: '#f0f5ff', borderRadius: 4, fontSize: 13, color: '#1d39c4' }}>
                  💡 你最活跃的时段是 <strong>{learningTime.summary.peak_weekday || '-'} 的 {learningTime.summary.peak_hour || '-'}</strong>，建议把每天的重点学习安排在这个时段，学习效率更高。
                </div>
              </>
            ) : (
              <Empty description="暂无答题时间数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          {/* 学习建议 */}
          <Card title="💡 学习建议" size="small" style={{ marginTop: 16 }}>
            <div style={{ lineHeight: 1.8, color: '#666' }}>
              {kpData.avg_accuracy && kpData.avg_accuracy >= 80 ? (
                <p>🎉 你的整体表现很优秀！继续保持，挑战更高难度的题目吧！</p>
              ) : kpData.avg_accuracy && kpData.avg_accuracy >= 60 ? (
                <p>👍 表现不错！重点复习薄弱知识点，可以进一步提升成绩。</p>
              ) : (
                <p>💪 需要加油！建议先巩固基础知识点，再逐步提升难度。</p>
              )}
              
              {weakPoints && weakPoints.count > 0 && (
                <div style={{ marginTop: 12, padding: '12px', background: '#fff7e6', borderRadius: 4 }}>
                  <strong>📌 建议复习顺序：</strong>
                  <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                    {weakPoints.weak_points.slice(0, 5).map((wp, idx) => (
                      <li key={idx}>
                        {wp.knowledge_point} (正确率 {wp.accuracy}%)
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default LearningDashboard;
