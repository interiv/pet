import React, { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Segmented, Select, Table, Tag, Empty, Spin, Modal,
  message, Descriptions, List, Progress as AntdProgress, Badge, notification, Space, Button
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

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

const ClassDashboard: React.FC = () => {
  const isMobile = useMobile();
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [days, setDays] = useState<number>(14);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<any>(null);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [studentDetail, setStudentDetail] = useState<any>(null);

  const [liveFeed, setLiveFeed] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [studentTablePage, setStudentTablePage] = useState(1);
  const [studentTablePageSize, setStudentTablePageSize] = useState(10);

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
    const reconnectHandler = () => {
      socket.emit('join-class-chat', currentClassId);
    };
    socket.on('assignment-submitted', handler);
    socket.on('connect', reconnectHandler);
    return () => {
      socket.emit('leave-class-chat', currentClassId);
      socket.off('assignment-submitted', handler);
      socket.off('connect', reconnectHandler);
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
      sorter: (a: any, b: any) => a.attempts - b.attempts,
      responsive: ['md'] as any,
    },
    {
      title: '正确率', dataIndex: 'accuracy', key: 'accuracy',
      render: (v: number) => <AntdProgress percent={Number(v) || 0} size="small" style={{ minWidth: 100 }} />,
      sorter: (a: any, b: any) => a.accuracy - b.accuracy,
      defaultSortOrder: 'descend' as const,
    },
    { title: '知识点', dataIndex: 'kp_count', key: 'kp_count', responsive: ['md'] as any },
    {
      title: '薄弱', dataIndex: 'weak_kp_count', key: 'weak_kp_count',
      responsive: ['md'] as any,
      render: (v: number) => v > 0 ? <Tag color="volcano">{v} 个</Tag> : <Tag color="green">无</Tag>
    },
    {
      title: '操作', key: 'action',
      render: (_: any, row: any) => (
        <a onClick={() => handleViewStudent(row.user_id)}>查看详情</a>
      ),
    },
  ];

  const renderMobileStudentCard = (record: any, idx: number) => (
    <Card
      key={record.user_id}
      size="small"
      style={{ marginBottom: 8, borderRadius: 8, cursor: 'pointer' }}
      onClick={() => handleViewStudent(record.user_id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag color={idx < 3 ? 'gold' : 'default'}>#{idx + 1}</Tag>
          <span style={{ fontWeight: 'bold', fontSize: 14 }}>{record.username}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {record.weak_kp_count > 0 && <Tag color="volcano" style={{ fontSize: 11 }}>{record.weak_kp_count}薄弱</Tag>}
          <a style={{ fontSize: 12 }}>详情</a>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <AntdProgress
          percent={Number(record.accuracy) || 0}
          size="small"
          status={(Number(record.accuracy) || 0) >= 70 ? 'success' : 'exception'}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999', marginTop: 2 }}>
          <span>正确率 {record.accuracy}%</span>
          <span>{record.attempts} 题 · {record.kp_count} 知识点</span>
        </div>
      </div>
    </Card>
  );

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <TeamOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        <span style={{ fontSize: isMobile ? 16 : 18, fontWeight: 'bold' }}>班级学情看板</span>
        <div style={{ flex: 1 }} />
        <Select
          style={{ minWidth: isMobile ? 130 : 200 }}
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
          size={isMobile ? 'small' : undefined}
        />
      </div>

      <Spin spinning={loading}>
        {!overview ? (
          <Empty description="暂无班级数据" />
        ) : overview.student_count === 0 ? (
          <Empty description="该班级暂无学生" />
        ) : (
          <>
            {overview.role === 'subject_teacher' && overview.teacher_subjects?.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
                <span style={{ color: '#d46b08', fontSize: isMobile ? 12 : undefined }}>📋 您是任课老师，仅可查看以下科目的数据：</span>
                {overview.teacher_subjects.map((s: string) => (
                  <Tag key={s} color="orange" style={{ marginLeft: 4 }}>{s}</Tag>
                ))}
              </div>
            )}
            {overview.role === 'head_teacher' && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                <span style={{ color: '#389e0d', fontSize: isMobile ? 12 : undefined }}>👨‍🏫 您是班主任，可查看该班级全学科数据</span>
              </div>
            )}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={12} md={6}>
                <Card><Statistic title="班级人数" value={overview.student_count} prefix={<TeamOutlined />} valueStyle={{ fontSize: isMobile ? 18 : undefined }} /></Card>
              </Col>
              <Col xs={12} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="整体正确率"
                    value={overview.avg_accuracy || 0}
                    suffix="%"
                    precision={2}
                    valueStyle={{ color: (overview.avg_accuracy || 0) >= 70 ? '#3f8600' : '#cf1322', fontSize: isMobile ? 18 : undefined }}
                    prefix={<AimOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="总答题数"
                    value={overview.total_attempts || 0}
                    prefix={<BarChartOutlined />}
                    valueStyle={{ fontSize: isMobile ? 18 : undefined }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={12} md={6}>
                <Card>
                  <Statistic
                    title="涉及知识点"
                    value={overview.knowledge_point_count || 0}
                    prefix={<TrophyOutlined />}
                    valueStyle={{ fontSize: isMobile ? 18 : undefined }}
                  />
                </Card>
              </Col>
            </Row>

            <Card title="学生分层" size="small" style={{ marginBottom: 16 }}>
              <Row gutter={[12, 12]}>
                <Col xs={12} sm={8} md={4}><Statistic title="优秀 (≥85%)" value={tierExcellent} valueStyle={{ color: '#52c41a', fontSize: isMobile ? 16 : undefined }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="良好 (70-85%)" value={tierGood} valueStyle={{ color: '#1677ff', fontSize: isMobile ? 16 : undefined }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="中等 (60-70%)" value={tierAverage} valueStyle={{ color: '#faad14', fontSize: isMobile ? 16 : undefined }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="待加强 (<60%)" value={tierStruggling} valueStyle={{ color: '#fa541c', fontSize: isMobile ? 16 : undefined }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="未答题" value={tierInactive} valueStyle={{ color: '#999', fontSize: isMobile ? 16 : undefined }} /></Col>
                <Col xs={12} sm={8} md={4}>
                  <MasteryRing percent={overview.avg_accuracy || 0} label="班级掌握率" height={120} />
                </Col>
              </Row>
            </Card>

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

            <Card title="学生明细（点击查看详情）" size="small" style={{ marginBottom: 16 }}>
              {isMobile ? (
                <div>
                  {rankings.length === 0 ? (
                    <Empty description="暂无学生数据" />
                  ) : (
                    rankings
                      .slice((studentTablePage - 1) * studentTablePageSize, studentTablePage * studentTablePageSize)
                      .map((record: any, idx: number) => {
                        const globalIdx = (studentTablePage - 1) * studentTablePageSize + idx;
                        return renderMobileStudentCard(record, globalIdx);
                      })
                  )}
                  {rankings.length > studentTablePageSize && (
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <Space>
                        <Button size="small" disabled={studentTablePage <= 1} onClick={() => setStudentTablePage(p => p - 1)}>上一页</Button>
                        <span style={{ fontSize: 12, color: '#999' }}>{studentTablePage} / {Math.ceil(rankings.length / studentTablePageSize)}</span>
                        <Button size="small" disabled={studentTablePage >= Math.ceil(rankings.length / studentTablePageSize)} onClick={() => setStudentTablePage(p => p + 1)}>下一页</Button>
                      </Space>
                    </div>
                  )}
                </div>
              ) : (
                <Table
                  dataSource={rankings}
                  columns={studentColumns}
                  rowKey="user_id"
                  size="small"
                  pagination={{
                    current: studentTablePage,
                    pageSize: studentTablePageSize,
                    onChange: (page, size) => {
                      setStudentTablePage(page);
                      setStudentTablePageSize(size);
                    },
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50'],
                    showTotal: (total) => `共 ${total} 条`
                  }}
                />
              )}
            </Card>

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
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: isMobile ? 12 : undefined }}>
                        <strong>{item.username}</strong>
                        <span>提交了</span>
                        <Tag color="blue" style={{ fontSize: isMobile ? 11 : undefined }}>{item.assignment_title}</Tag>
                        <span>得分</span>
                        <Tag color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'} style={{ fontSize: isMobile ? 11 : undefined }}>
                          {item.total_score}分
                        </Tag>
                        {!isMobile && <span>答对 {item.correct_count}/{item.total_count}</span>}
                        {item.combo_streak >= 3 && (
                          <Tag color="volcano">🔥 {item.combo_streak} 连对</Tag>
                        )}
                        <span style={{ color: '#999', fontSize: 11, marginLeft: 'auto' }}>
                          {new Date(item.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>

            {overview.top_weak && overview.top_weak.length > 0 && (
              <Card title="📌 教学建议" size="small" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#8c6e00', fontSize: isMobile ? 13 : undefined }}>
                  <li>
                    班级最薄弱知识点：
                    {overview.top_weak.slice(0, 3).map((k: any) => (
                      <Tag key={k.knowledge_point} color="volcano" style={{ marginLeft: 4, fontSize: isMobile ? 11 : undefined }}>
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

      <Modal
        title={studentDetail?.student ? `${studentDetail.student.username} 的学情详情` : '学生详情'}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={isMobile ? '95%' : 900}
      >
        <Spin spinning={detailLoading}>
          {studentDetail ? (
            <>
              {studentDetail.role === 'subject_teacher' && studentDetail.teacher_subjects?.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
                  <span style={{ color: '#d46b08' }}>📋 您是任课老师，仅可查看以下科目的数据：</span>
                  {studentDetail.teacher_subjects.map((s: string) => (
                    <Tag key={s} color="orange" style={{ marginLeft: 4 }}>{s}</Tag>
                  ))}
                </div>
              )}
              {studentDetail.role === 'head_teacher' && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                  <span style={{ color: '#389e0d' }}>👨‍🏫 您是班主任，可查看该学生全学科数据</span>
                </div>
              )}

              <Descriptions size="small" bordered column={isMobile ? 1 : 2} style={{ marginBottom: 16 }}>
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

              {studentDetail.subject_stats && studentDetail.subject_stats.length > 0 && (
                <Card size="small" title="各科目表现" style={{ marginBottom: 12 }}>
                  <List
                    size="small"
                    dataSource={studentDetail.subject_stats}
                    renderItem={(item: any) => (
                      <List.Item>
                        <Tag color="blue">{item.subject}</Tag>
                        <span style={{ flex: 1, marginLeft: 8 }}>
                          <AntdProgress
                            percent={item.accuracy || 0}
                            size="small"
                            status={(item.accuracy || 0) >= 70 ? 'success' : 'exception'}
                            style={{ maxWidth: isMobile ? 120 : 200 }}
                          />
                        </span>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {item.correct}/{item.total} 题
                        </span>
                      </List.Item>
                    )}
                  />
                </Card>
              )}

              {studentDetail.weak_points && studentDetail.weak_points.length > 0 && (
                <Card size="small" title="薄弱知识点" style={{ marginBottom: 12 }}>
                  <List
                    size="small"
                    dataSource={studentDetail.weak_points}
                    renderItem={(item: any) => (
                      <List.Item>
                        <span style={{ fontSize: isMobile ? 12 : undefined }}>{item.knowledge_point}</span>
                        <AntdProgress
                          percent={item.accuracy || 0}
                          size="small"
                          status="exception"
                          style={{ maxWidth: isMobile ? 80 : 200 }}
                        />
                        <span style={{ color: '#999', fontSize: isMobile ? 11 : 12 }}>
                          {item.correct_attempts}/{item.total_attempts}
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {item.subject && <Tag color="blue" style={{ fontSize: isMobile ? 11 : undefined }}>{item.subject}</Tag>}
                          {item.knowledge_point && <Tag color="orange" style={{ fontSize: isMobile ? 11 : undefined }}>🏷️ {item.knowledge_point}</Tag>}
                          <span style={{ marginLeft: 8, fontSize: isMobile ? 12 : undefined }}>
                            {(item.content || '').substring(0, isMobile ? 30 : 60)}
                            {(item.content || '').length > (isMobile ? 30 : 60) ? '...' : ''}
                          </span>
                        </div>
                        <Tag color="red" style={{ fontSize: isMobile ? 11 : undefined }}>
                          错 {item.wrong_count} 次
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
