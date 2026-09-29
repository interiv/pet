import React, { useEffect, useState } from 'react';
import { Card, Table, message, Tag, Space, Select, Row, Col, Statistic, List, Empty, Spin } from 'antd';
import { UserOutlined, TeamOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { useAuthStore } from '../../store/authStore';
import { useMobile } from './hooks';

const ClassTeachingOverview: React.FC = () => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const headClasses = (user as any).teacher_classes?.filter((c: any) => c.class_role === 'head_teacher') || [];
    setClasses(headClasses);
    if (headClasses.length > 0) {
      setSelectedClassId(headClasses[0].id);
    }
  }, [user]);

  useEffect(() => {
    if (selectedClassId) loadClassData();
  }, [selectedClassId]);

  const loadClassData = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    try {
      const res = await adminAPI.getClassTeacherActivity(selectedClassId);
      setData(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载班级教学数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (classes.length === 0) {
    return <Card><Empty description="您还不是任何班级的班主任" /></Card>;
  }

  const d = data || {};
  const classInfo = d.class_info || {};
  const teachers = d.teachers || [];
  const subjectStats = d.subject_stats || [];
  const strugglingStudents = d.struggling_students || [];
  const inactiveStudents = d.inactive_students || [];
  const recentSubmissions = d.recent_submissions || [];

  return (
    <div>
      {/* 班级选择 */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ marginRight: 8, fontWeight: 500 }}>选择班级：</span>
        <Select
          value={selectedClassId}
          onChange={setSelectedClassId}
          style={{ width: isMobile ? '100%' : 240 }}
          options={classes.map((c: any) => ({ value: c.id, label: `${c.name}${c.grade ? ` (${c.grade})` : ''}` }))}
        />
      </div>

      <Spin spinning={loading}>
        {/* 班级概况 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card><Statistic title="学生数" value={classInfo.student_count || 0} prefix={<TeamOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card><Statistic title="任课教师" value={teachers.length} prefix={<UserOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card><Statistic title="学科数" value={subjectStats.length} /></Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card><Statistic title="待审申请" value={d.pending_applications || 0} valueStyle={{ color: (d.pending_applications || 0) > 0 ? '#faad14' : '#52c41a' }} /></Card>
          </Col>
        </Row>

        {/* 任课老师教学数据 */}
        <Card title="👩‍🏫 任课教师教学情况" size="small" style={{ marginBottom: 16 }}>
          {teachers.length > 0 ? (
            <Table
              dataSource={teachers}
              rowKey="teacher_id"
              size="small"
              pagination={false}
              scroll={{ x: true }}
              columns={[
                { title: '教师', dataIndex: 'real_name', key: 'username', width: 80, fixed: isMobile ? 'left' as const : undefined, render: (v: string, r: any) => v || r.username },
                { title: '身份', dataIndex: 'class_role', key: 'class_role', width: 70, render: (v: string) => <Tag color={v === 'head_teacher' ? 'gold' : 'blue'}>{v === 'head_teacher' ? '班主任' : '任课'}</Tag> },
                { title: '总作业', dataIndex: 'total_assignments', key: 'total_assignments', width: 70, render: (v: number) => <Tag>{v}</Tag> },
                { title: '近30天', dataIndex: 'recent_assignments', key: 'recent_assignments', width: 70, render: (v: number) => <Tag color="blue">{v}</Tag> },
                { title: '总提交', dataIndex: 'total_submissions', key: 'total_submissions', width: 70, render: (v: number) => <Tag color="green">{v}</Tag> },
                { title: '近7天提交', dataIndex: 'recent_submissions', key: 'recent_submissions', width: 80, render: (v: number) => <Tag color="cyan">{v}</Tag> },
                { title: '待批改', dataIndex: 'ungraded_count', key: 'ungraded_count', width: 70, render: (v: number) => v > 0 ? <Tag color="warning">{v}</Tag> : <Tag color="default">0</Tag> },
              ]}
            />
          ) : (
            <Empty description="暂无任课教师数据" />
          )}
        </Card>

        {/* 各科成绩对比 */}
        {subjectStats.length > 0 && (
          <Card title="📊 各科成绩对比" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[16, 16]}>
              {subjectStats.map((s: any) => (
                <Col xs={24} sm={12} md={8} key={s.subject}>
                  <Card size="small" style={{ background: '#fafafa' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{s.subject}</div>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#888', fontSize: 12 }}>作业数</span>
                        <Tag>{s.assignment_count}</Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#888', fontSize: 12 }}>参与学生</span>
                        <Tag color="blue">{s.active_students}</Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#888', fontSize: 12 }}>平均正确率</span>
                        <Tag color={s.avg_accuracy >= 80 ? 'success' : s.avg_accuracy >= 60 ? 'warning' : 'error'}>{s.avg_accuracy ?? '-'}%</Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#888', fontSize: 12 }}>平均分</span>
                        <span style={{ fontWeight: 500 }}>{s.avg_score ?? '-'}</span>
                      </div>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        )}

        {/* 薄弱学生 + 不活跃学生 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={12}>
            <Card title="⚠️ 薄弱学生（知识点正确率<60%）" size="small">
              {strugglingStudents.length > 0 ? (
                <Table
                  dataSource={strugglingStudents}
                  rowKey="user_id"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '学生', dataIndex: 'real_name', key: 'username', render: (v: string, r: any) => v || r.username },
                    { title: '薄弱知识点', dataIndex: 'weak_kp_count', key: 'weak_kp_count', render: (v: number) => <Tag color="error">{v}</Tag> },
                    { title: '总知识点', dataIndex: 'total_kp_count', key: 'total_kp_count' },
                    { title: '平均正确率', dataIndex: 'avg_accuracy', key: 'avg_accuracy', render: (v: number) => v != null ? <Tag color={v >= 60 ? 'warning' : 'error'}>{v}%</Tag> : '-' },
                  ]}
                />
              ) : (
                <Empty description="暂无薄弱学生数据" />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="😴 不活跃学生（7天未登录）" size="small">
              {inactiveStudents.length > 0 ? (
                <List
                  size="small"
                  dataSource={inactiveStudents}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Space>
                        <span>{item.real_name || item.username}</span>
                        <span style={{ color: '#bbb', fontSize: 12 }}>
                          {item.last_login ? `最后登录: ${new Date(item.last_login).toLocaleDateString()}` : '从未登录'}
                        </span>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="所有学生近7天均有活动" />
              )}
            </Card>
          </Col>
        </Row>

        {/* 最近提交动态 */}
        {recentSubmissions.length > 0 && (
          <Card title="📥 最近作业提交" size="small">
            <List
              size="small"
              dataSource={recentSubmissions}
              renderItem={(item: any) => (
                <List.Item>
                  <Space>
                    <span style={{ fontWeight: 500 }}>{item.student_name}</span>
                    <span style={{ color: '#888' }}>提交了</span>
                    <Tag color="blue">{item.assignment_title}</Tag>
                    {item.subject && <Tag>{item.subject}</Tag>}
                    {item.total_score != null && (
                      <Tag color={item.total_score / (item.total_max_score || 1) >= 0.6 ? 'success' : 'error'}>
                        {item.total_score}/{item.total_max_score}
                      </Tag>
                    )}
                    <span style={{ color: '#bbb', fontSize: 11 }}>{new Date(item.submitted_at).toLocaleString()}</span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        )}
      </Spin>
    </div>
  );
};

export { ClassTeachingOverview };
export default ClassTeachingOverview;
