import React, { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Segmented, Select, Table, Tag, Empty, Spin, Modal,
  message, Descriptions, List, Progress as AntdProgress, Badge, notification
} from 'antd';
import {
  TeamOutlined, AimOutlined, TrophyOutlined, WarningOutlined,
  BarChartOutlined, CheckCircleOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import { knowledgePointAPI, adminAPI } from '../utils/api';
import {
  MasteryRing, AccuracyColumn, WeakPointBar, DistributionPie
} from './charts/ChartKit';

/**
 * 教师端班级学情看板
 * - 班级整体掌握率、学生分层
 * - 薄弱/优势知识点排行
 * - 学科分布
 * - 学生明细表（支持点击钻取查看单个学生）
 */
const ClassDashboard: React.FC = () => {
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [days, setDays] = useState<number>(14);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<any>(null);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [studentDetail, setStudentDetail] = useState<any>(null);

  // 实时提交流
  const [liveFeed, setLiveFeed] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(
      (import.meta as any).env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000',
      { transports: ['websocket', 'polling'] }
    );
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    if (!socket || !selectedClassId) return;
    // 加入班级房间以接收提交事件
    const currentClassId = selectedClassId;
    socket.emit('join-class-chat', currentClassId);
    const handler = (payload: any) => {
      if (payload.class_id !== currentClassId) return;
      setLiveFeed((prev) => [payload, ...prev].slice(0, 20));
      notification.info({
        message: `📢 ${payload.username} 刚刚提交了作业`,
        description: `${payload.assignment_title} | 得分 ${payload.total_score} | 答对 ${payload.correct_count}/${payload.total_count}${payload.combo_streak >= 3 ? ` 🔥 ${payload.combo_streak}连` : ''}`,
        placement: 'bottomRight',
        duration: 4,
      });
    };
    // 断线重连后重新 join
    const reconnectHandler = () => {
      socket.emit('join-class-chat', currentClassId);
    };
    socket.on('assignment-submitted', handler);
    socket.on('connect', reconnectHandler);
    socket.io?.on?.('reconnect', reconnectHandler);
    return () => {
      // 离开旧班级房间，避免收到旧班级的推送
      socket.emit('leave-class-chat', currentClassId);
      socket.off('assignment-submitted', handler);
      socket.off('connect', reconnectHandler);
      socket.io?.off?.('reconnect', reconnectHandler);
    };
  }, [socket, selectedClassId]);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedClassId) loadOverview();
  }, [selectedClassId, days]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      const list = res.data.classes || [];
      setClasses(list);
      if (list.length > 0) setSelectedClassId(list[0].id);
    } catch (e) {
      message.error('加载班级列表失败');
    }
  };

  const loadOverview = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    try {
      const res = await knowledgePointAPI.getClassOverview(selectedClassId, { days });
      setOverview(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载班级学情失败');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  };

  const handleViewStudent = async (userId: number) => {
    if (!selectedClassId) return;
    setDetailVisible(true);
    setDetailLoading(true);
    setStudentDetail(null);
    try {
      const res = await knowledgePointAPI.getClassStudentDetail(selectedClassId, userId, { days });
      setStudentDetail(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载学生详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // —— 衍生数据 ——
  const weakColumnData = (overview?.top_weak || []).map((k: any) => ({
    name: k.knowledge_point, accuracy: k.accuracy || 0
  }));
  const masteredColumnData = (overview?.top_mastered || []).map((k: any) => ({
    name: k.knowledge_point, accuracy: k.accuracy || 0
  }));
  const subjectPieData = (overview?.subject_distribution || []).map((s: any) => ({
    type: s.subject || '未分类', value: s.total || 0
  }));
  const subjectAccuracyData = (overview?.subject_distribution || []).map((s: any) => ({
    name: s.subject || '未分类', accuracy: s.accuracy || 0
  }));

  // 学生分层统计
  const rankings = overview?.student_rankings || [];
  const tierExcellent = rankings.filter((r: any) => r.accuracy >= 85).length;
  const tierGood = rankings.filter((r: any) => r.accuracy >= 70 && r.accuracy < 85).length;
  const tierAverage = rankings.filter((r: any) => r.accuracy >= 60 && r.accuracy < 70).length;
  const tierStruggling = rankings.filter((r: any) => r.accuracy > 0 && r.accuracy < 60).length;
  const tierInactive = rankings.filter((r: any) => !r.attempts).length;

  const studentColumns = [
    {
      title: '排名', key: 'rank', width: 60,
      render: (_: any, __: any, idx: number) => <Tag color={idx < 3 ? 'gold' : 'default'}>#{idx + 1}</Tag>,
    },
    { title: '学生', dataIndex: 'username', key: 'username' },
    {
      title: '答题数', dataIndex: 'attempts', key: 'attempts',
      sorter: (a: any, b: any) => a.attempts - b.attempts
    },
    {
      title: '正确率', dataIndex: 'accuracy', key: 'accuracy',
      render: (v: number) => <AntdProgress percent={Number(v) || 0} size="small" style={{ minWidth: 140 }} />,
      sorter: (a: any, b: any) => a.accuracy - b.accuracy,
      defaultSortOrder: 'descend' as const,
    },
    { title: '涉及知识点', dataIndex: 'kp_count', key: 'kp_count' },
    {
      title: '薄弱知识点', dataIndex: 'weak_kp_count', key: 'weak_kp_count',
      render: (v: number) => v > 0 ? <Tag color="volcano">{v} 个</Tag> : <Tag color="green">无</Tag>
    },
    {
      title: '操作', key: 'action',
      render: (_: any, row: any) => (
        <a onClick={() => handleViewStudent(row.user_id)}>查看详情</a>
      )
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <TeamOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        <span style={{ fontSize: 18, fontWeight: 'bold' }}>班级学情看板</span>
        <div style={{ flex: 1 }} />
        <Select
          style={{ minWidth: 200 }}
          placeholder="选择班级"
          value={selectedClassId ?? undefined}
          onChange={setSelectedClassId}
          options={classes.map(c => ({ label: c.name, value: c.id }))}
        />
        <Segmented
          options={[
            { label: '近7天', value: 7 },
            { label: '近14天', value: 14 },
            { label: '近30天', value: 30 },
          ]}
          value={days}
          onChange={(v) => setDays(v as number)}
        />
      </div>

      <Spin spinning={loading}>
        {!overview ? (
          <Empty description="暂无班级数据" />
        ) : overview.student_count === 0 ? (
          <Empty description="该班级暂无学生" />
        ) : (
          <>
            {/* —— 顶部指标 —— */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} sm={12} md={6}>
                <Card><Statistic title="班级人数" value={overview.student_count} prefix={<TeamOutlined />} /></Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="整体正确率"
                    value={overview.avg_accuracy || 0}
                    suffix="%"
                    precision={2}
                    valueStyle={{ color: (overview.avg_accuracy || 0) >= 70 ? '#3f8600' : '#cf1322' }}
                    prefix={<AimOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="总答题数"
                    value={overview.total_attempts || 0}
                    prefix={<BarChartOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="涉及知识点"
                    value={overview.knowledge_point_count || 0}
                    prefix={<TrophyOutlined />}
                  />
                </Card>
              </Col>
            </Row>

            {/* —— 学生分层 —— */}
            <Card title="学生分层" size="small" style={{ marginBottom: 16 }}>
              <Row gutter={[12, 12]}>
                <Col xs={12} sm={8} md={4}><Statistic title="优秀 (≥85%)" value={tierExcellent} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="良好 (70-85%)" value={tierGood} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="中等 (60-70%)" value={tierAverage} valueStyle={{ color: '#faad14' }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="待加强 (<60%)" value={tierStruggling} valueStyle={{ color: '#fa541c' }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="未答题" value={tierInactive} valueStyle={{ color: '#999' }} /></Col>
                <Col xs={12} sm={8} md={4}>
                  <MasteryRing percent={overview.avg_accuracy || 0} label="班级掌握率" height={120} />
                </Col>
              </Row>
            </Card>

            {/* —— 图表分析 —— */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} lg={12}>
                <Card title={<><WarningOutlined style={{ color: '#fa541c' }} /> 班级薄弱知识点</>} size="small">
                  <WeakPointBar data={weakColumnData} height={300} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title={<><CheckCircleOutlined style={{ color: '#52c41a' }} /> 班级优势知识点</>} size="small">
                  <AccuracyColumn data={masteredColumnData} height={300} />
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} lg={12}>
                <Card title="学科练习量分布" size="small">
                  <DistributionPie data={subjectPieData} height={300} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="各学科正确率" size="small">
                  <AccuracyColumn data={subjectAccuracyData} height={300} />
                </Card>
              </Col>
            </Row>

            {/* —— 学生明细 —— */}
            <Card title="学生明细（点击查看详情）" size="small" style={{ marginBottom: 16 }}>
              <Table
                dataSource={rankings}
                columns={studentColumns}
                rowKey="user_id"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: true }}
              />
            </Card>

            {/* —— 实时提交流 —— */}
            <Card
              title={
                <span>
                  <ThunderboltOutlined style={{ color: '#52c41a' }} /> 实时提交流
                  {liveFeed.length > 0 && (
                    <Badge count={liveFeed.length} style={{ marginLeft: 8, backgroundColor: '#52c41a' }} />
                  )}
                </span>
              }
              size="small"
              style={{ marginBottom: 16 }}
              extra={<span style={{ fontSize: 12, color: '#999' }}>等待学生提交作业…</span>}
            >
              {liveFeed.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 16, fontSize: 13 }}>
                  📡 已连接实时频道，当学生提交作业时会在这里推送通知。
                </div>
              ) : (
                <List
                  size="small"
                  dataSource={liveFeed}
                  renderItem={(item: any) => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>{item.username}</strong>
                        <span>提交了</span>
                        <Tag color="blue">{item.assignment_title}</Tag>
                        <span>得分</span>
                        <Tag color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'}>
                          {item.total_score}分
                        </Tag>
                        <span>答对 {item.correct_count}/{item.total_count}</span>
                        {item.combo_streak >= 3 && (
                          <Tag color="volcano">🔥 {item.combo_streak} 连对</Tag>
                        )}
                        <span style={{ color: '#999', fontSize: 12, marginLeft: 'auto' }}>
                          {new Date(item.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>

            {/* —— 教学建议 —— */}
            {overview.top_weak && overview.top_weak.length > 0 && (
              <Card title="📌 教学建议" size="small" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#8c6e00' }}>
                  <li>
                    班级最薄弱知识点：
                    {overview.top_weak.slice(0, 3).map((k: any) => (
                      <Tag key={k.knowledge_point} color="volcano" style={{ marginLeft: 4 }}>
                        {k.knowledge_point} ({k.accuracy}%)
                      </Tag>
                    ))}
                    建议安排专项练习或重讲。
                  </li>
                  {tierStruggling > 0 && (
                    <li>有 {tierStruggling} 位学生正确率低于 60%，建议个别辅导或调整作业难度。</li>
                  )}
                  {tierInactive > 0 && (
                    <li>有 {tierInactive} 位学生近期未答题，建议了解原因并跟进。</li>
                  )}
                  {overview.avg_accuracy >= 80 && (
                    <li>班级整体表现优秀，可适当增加题目难度或引入拓展题。</li>
                  )}
                </ul>
              </Card>
            )}
          </>
        )}
      </Spin>

      {/* —— 学生详情 Modal —— */}
      <Modal
        title={studentDetail?.student ? `${studentDetail.student.username} 的学情详情` : '学生详情'}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={900}
      >
        <Spin spinning={detailLoading}>
          {studentDetail ? (
            <>
              <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="知识点数量">
                  {studentDetail.knowledge_points?.length || 0}
                </Descriptions.Item>
                <Descriptions.Item label="薄弱知识点">
                  <Tag color="volcano">{studentDetail.weak_points?.length || 0} 个</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="已掌握">
                  <Tag color="green">{studentDetail.mastered_points?.length || 0} 个</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="近期错题">
                  {studentDetail.recent_wrong?.length || 0} 条
                </Descriptions.Item>
              </Descriptions>

              {studentDetail.weak_points && studentDetail.weak_points.length > 0 && (
                <Card size="small" title="薄弱知识点" style={{ marginBottom: 12 }}>
                  <List
                    size="small"
                    dataSource={studentDetail.weak_points}
                    renderItem={(item: any) => (
                      <List.Item>
                        <span>{item.knowledge_point}</span>
                        <AntdProgress
                          percent={item.accuracy || 0}
                          size="small"
                          status="exception"
                          style={{ width: 200 }}
                        />
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {item.correct_attempts}/{item.total_attempts} 题
                        </span>
                      </List.Item>
                    )}
                  />
                </Card>
              )}

              {studentDetail.recent_wrong && studentDetail.recent_wrong.length > 0 && (
                <Card size="small" title="近期错题 (最多20条)">
                  <List
                    size="small"
                    dataSource={studentDetail.recent_wrong.slice(0, 10)}
                    renderItem={(item: any) => (
                      <List.Item>
                        <div style={{ flex: 1 }}>
                          {item.subject && <Tag color="blue">{item.subject}</Tag>}
                          {item.knowledge_point && <Tag color="orange">🏷️ {item.knowledge_point}</Tag>}
                          <span style={{ marginLeft: 8 }}>
                            {(item.content || '').substring(0, 60)}
                            {(item.content || '').length > 60 ? '...' : ''}
                          </span>
                        </div>
                        <Tag color={item.is_resolved ? 'green' : 'red'}>
                          {item.is_resolved ? '已解决' : `错 ${item.wrong_count} 次`}
                        </Tag>
                      </List.Item>
                    )}
                  />
                </Card>
              )}
            </>
          ) : (
            !detailLoading && <Empty description="暂无数据" />
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default ClassDashboard;
