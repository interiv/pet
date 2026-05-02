import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tabs, Form, Input, message, Tag, Space, Modal, Select, InputNumber, Popconfirm, Row, Col, Statistic, List, Descriptions, Badge, Switch, Alert, Empty, Spin } from 'antd';
import { UserOutlined, TeamOutlined, FolderOutlined, NotificationOutlined, DeleteOutlined, EditOutlined, PlusOutlined, DatabaseOutlined, GlobalOutlined, SafetyOutlined, ThunderboltOutlined, RobotOutlined, BankOutlined, TrophyOutlined, EyeOutlined, FireOutlined } from '@ant-design/icons';
import { adminAPI, schoolAPI, assignmentAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import ClassInvitationManager from './ClassInvitationManager';
import AchievementManagement from './admin/AchievementManagement';
import BossBattleManager from './BossBattleManager';

const useTablePagination = (defaultPageSize = 10) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  return {
    current: page,
    pageSize,
    onChange: (p: number, ps: number) => { setPage(p); setPageSize(ps); },
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50'],
    showTotal: (total: number) => `共 ${total} 条`
  };
};

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface AdminProps {
  defaultTab?: string;
}

const Admin: React.FC<AdminProps> = ({ defaultTab }) => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [activeTab, setActiveTab] = useState(defaultTab || 'dashboard');

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  const getTabItems = () => {
    if (isAdmin) {
      return [
        { key: 'dashboard', label: <span><TeamOutlined /> 总览</span>, children: <Dashboard /> },
        { key: 'teachers', label: <span><UserOutlined /> 教师管理</span>, children: <TeacherManagement /> },
        { key: 'students', label: <span><TeamOutlined /> 学生管理</span>, children: <StudentManagement /> },
        { key: 'classes', label: <span><FolderOutlined /> 班级管理</span>, children: <ClassManagement /> },
        { key: 'schools', label: <span><BankOutlined /> 学校管理</span>, children: <SchoolManagement /> },
        { key: 'applications', label: <span><TeamOutlined /> 入学申请</span>, children: <ApplicationManagement /> },
        { key: 'announcements', label: <span><NotificationOutlined /> 公告管理</span>, children: <AnnouncementManagement /> },
        { key: 'dataview', label: <span><DatabaseOutlined /> 数据查看</span>, children: <DataView /> },
        { key: 'site_settings', label: <span><GlobalOutlined /> 网站设置</span>, children: <SiteSettings /> },
        { key: 'ai_settings', label: <span><RobotOutlined /> AI设置</span>, children: <AISettings /> },
        { key: 'achievements', label: <span><TrophyOutlined /> 成就管理</span>, children: <AchievementManagement /> },
      ];
    } else if (isTeacher) {
      const isHeadTeacher = (user as any).teacher_classes?.some((c: any) => c.class_role === 'head_teacher');
      const items = [
        { key: 'dashboard', label: <span><TeamOutlined /> 总览</span>, children: <Dashboard /> },
        { key: 'students', label: <span><TeamOutlined /> 学生管理</span>, children: <StudentManagement /> },
        { key: 'classes', label: <span><FolderOutlined /> 班级管理</span>, children: <ClassManagement /> },
      ];
      if (isHeadTeacher) {
        items.push(
          { key: 'class-invitation', label: <span><TeamOutlined /> 邀请设置</span>, children: <ClassInvitationManager /> },
          { key: 'applications', label: <span><TeamOutlined /> 入学申请</span>, children: <ApplicationManagement /> },
        );
      }
      items.push(
        { key: 'boss', label: <span><FireOutlined /> BOSS管理</span>, children: <BossBattleManager /> },
        { key: 'dataview', label: <span><DatabaseOutlined /> 数据查看</span>, children: <DataView /> },
      );
      return items;
    }
    return [];
  };

  const getTitle = () => {
    if (isAdmin) return '管理控制台';
    if (isTeacher) return '教师工作台';
    return '控制台';
  };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <h2 style={{ marginBottom: isMobile ? 16 : 24 }}>{getTitle()}</h2>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={getTabItems()} />
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [statistics, setStatistics] = useState<any>(null);
  const [operationalStats, setOperationalStats] = useState<any>(null);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, opsRes] = await Promise.all([
        adminAPI.getStatistics(),
        isAdmin ? adminAPI.getOperationalStats().catch(() => ({ data: {} })) : Promise.resolve({ data: {} })
      ]);
      setStatistics(statsRes.data.statistics);
      setOperationalStats(opsRes.data);
    } catch (error) {
      message.error('加载统计数据失败');
    }
  };

  if (!statistics) return null;

  // 教师工作台
  if (!isAdmin) {
    return (
      <div>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={12}>
            <Card><Statistic title="我的班级" value={statistics.classes.total || 0} prefix={<FolderOutlined />} /></Card>
          </Col>
          <Col span={12}>
            <Card><Statistic title="班级学生数" value={statistics.users.students || 0} prefix={<TeamOutlined />} /></Card>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Card title="班级概况">
              <p>欢迎来到教师工作台！您可以管理您的班级和入学申请。</p>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  // 简易趋势条形图
  const MiniBarChart = ({ data, color = '#1890ff', height = 60 }: { data: { date: string; count: number }[]; color?: string; height?: number }) => {
    if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>暂无数据</div>;
    const max = Math.max(...data.map(d => d.count), 1);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, padding: '4px 0' }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#999' }}>{d.count}</span>
            <div style={{ width: '100%', background: color, borderRadius: 3, height: `${(d.count / max) * (height - 20)}px`, minHeight: d.count > 0 ? 4 : 0, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 9, color: '#bbb' }}>{d.date.slice(5)}</span>
          </div>
        ))}
      </div>
    );
  };

  const ops = operationalStats || {};
  const pendingTeachers = ops.pending?.teachers ?? statistics.status?.pending_teachers ?? 0;
  const pendingApps = ops.pending?.applications ?? 0;
  const dauTrend = ops.trends?.dau || [];
  const submissionTrend = ops.trends?.submissions || [];
  const assignmentTrend = ops.trends?.assignments || [];
  const teacherActivity = ops.teacher_activity || [];
  const recentEvents = ops.recent_events || [];

  const eventIconMap: Record<string, string> = {
    register: '👤',
    assignment: '📝',
    announcement: '📢',
  };

  return (
    <div>
      {/* 待处理事项 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} sm={12}>
          <Card
            hoverable
            style={{ borderLeft: pendingTeachers > 0 ? '4px solid #faad14' : '4px solid #d9d9d9' }}
            styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>待审批教师</div>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: pendingTeachers > 0 ? '#faad14' : '#52c41a' }}>{pendingTeachers}</div>
              </div>
              <div style={{ fontSize: 36, opacity: 0.3 }}>👩‍🏫</div>
            </div>
            {pendingTeachers > 0 && <div style={{ marginTop: 8, fontSize: 12, color: '#faad14' }}>有待审批的教师注册申请</div>}
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card
            hoverable
            style={{ borderLeft: pendingApps > 0 ? '4px solid #1890ff' : '4px solid #d9d9d9' }}
            styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>待处理入学申请</div>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: pendingApps > 0 ? '#1890ff' : '#52c41a' }}>{pendingApps}</div>
              </div>
              <div style={{ fontSize: 36, opacity: 0.3 }}>📋</div>
            </div>
            {pendingApps > 0 && <div style={{ marginTop: 8, fontSize: 12, color: '#1890ff' }}>有待处理的班级入学申请</div>}
          </Card>
        </Col>
      </Row>

      {/* 核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={12} sm={6}>
          <Card><Statistic title="总用户" value={statistics.users.total} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="今日活跃" value={statistics.daily?.active_users || 0} prefix={<UserOutlined />} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="班级数" value={statistics.classes.total} prefix={<FolderOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="教师/学生" value={`${statistics.users.teachers}/${statistics.users.students}`} valueStyle={{ fontSize: 20 }} /></Card>
        </Col>
      </Row>

      {/* 趋势图 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} md={8}>
          <Card title="📈 7日活跃用户" size="small">
            <MiniBarChart data={dauTrend} color="#52c41a" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="📝 7日作业提交" size="small">
            <MiniBarChart data={submissionTrend} color="#1890ff" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="📚 7日作业发布" size="small">
            <MiniBarChart data={assignmentTrend} color="#722ed1" />
          </Card>
        </Col>
      </Row>

      {/* 教师活跃度排行 + 最近事件 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="👩‍🏫 教师活跃度（近30天）" size="small">
            {teacherActivity.length > 0 ? (
              <Table
                dataSource={teacherActivity}
                rowKey="teacher_id"
                size="small"
                pagination={false}
                columns={[
                  { title: '教师', dataIndex: 'username', key: 'username', width: 100 },
                  { title: '布置作业', dataIndex: 'assignment_count', key: 'assignment_count', width: 80, render: (v: number) => <Tag color="blue">{v}</Tag> },
                  { title: '收到提交', dataIndex: 'submission_count', key: 'submission_count', width: 80, render: (v: number) => <Tag color="green">{v}</Tag> },
                  { title: '待批改', dataIndex: 'ungraded_count', key: 'ungraded_count', width: 80, render: (v: number) => v > 0 ? <Tag color="warning">{v}</Tag> : <Tag color="default">0</Tag> },
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#bbb' }}>暂无教师活动数据</div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="🔔 最近事件" size="small">
            {recentEvents.length > 0 ? (
              <List
                size="small"
                dataSource={recentEvents}
                renderItem={(item: any) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <Space>
                      <span>{eventIconMap[item.type] || '📌'}</span>
                      <span style={{ fontSize: 13 }}>{item.message}</span>
                      <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>{new Date(item.time).toLocaleDateString()}</span>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#bbb' }}>暂无事件</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 班级排行 + 商品排行（保留原有） */}
      <Row gutter={[16, 16]} style={{ marginTop: isMobile ? 12 : 20 }}>
        <Col xs={24} lg={12}>
          <Card title="🏆 班级经验排行" size="small">
            <List
              size="small"
              dataSource={statistics.top_classes}
              renderItem={(item: any, index: number) => (
                <List.Item>
                  <Space>
                    <Badge count={index + 1} style={{ backgroundColor: index < 3 ? '#f5222d' : '#999' }} />
                    <span>{item.name}</span>
                    <Tag>班主任: {item.teacher_name || '未分配'}</Tag>
                    <Tag color="orange">学生: {item.student_count}</Tag>
                    <Tag color="green">经验: {item.total_exp}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="🛒 商品销售排行" size="small">
            <Table
              dataSource={statistics.top_selling_items}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: '排名', render: (_: any, __: any, index: number) => index + 1, width: 50 },
                { title: '商品', dataIndex: 'name', key: 'name' },
                { title: '稀有度', dataIndex: 'rarity', key: 'rarity', width: 80, render: (v: string) => <Tag color={v === 'legendary' ? 'gold' : v === 'epic' ? 'purple' : v === 'rare' ? 'blue' : v === 'uncommon' ? 'green' : 'default'}>{v}</Tag> },
                { title: '购买次数', dataIndex: 'purchase_count', key: 'purchase_count', width: 80 },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export const ClassTeachingOverview: React.FC = () => {
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
                { title: '教师', dataIndex: 'username', key: 'username', width: 80, fixed: isMobile ? 'left' as const : undefined },
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
                    { title: '学生', dataIndex: 'username', key: 'username' },
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
                        <span>{item.username}</span>
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

const ApplicationManagement: React.FC = () => {
  const pagination = useTablePagination();
  const { user } = useAuthStore();
  const [applications, setApplications] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [classFilter, setClassFilter] = useState<number | null>(null);

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  useEffect(() => {
    loadApplications();
    loadClasses();
  }, [statusFilter, classFilter]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      let allClasses = res.data.classes || [];
      if (isTeacher && !isAdmin) {
        allClasses = allClasses.filter((c: any) =>
          c.teachers?.some((t: any) => t.teacher_id === user?.id && t.role === 'head_teacher')
        );
      }
      setClasses(allClasses);
    } catch (error) {
      console.error('加载班级列表失败');
    }
  };

  const loadApplications = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      if (classFilter) params.class_id = classFilter;
      const res = await adminAPI.getClassApplications(params);
      setApplications(res.data.applications || []);
    } catch (error: any) {
      message.error(error.response?.data?.error || '加载申请列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await adminAPI.reviewClassApplication(id, { status });
      message.success(status === 'approved' ? '已批准该申请' : '已拒绝该申请');
      loadApplications();
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    }
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'pending': return <Tag color="orange">待审批</Tag>;
      case 'approved': return <Tag color="green">已批准</Tag>;
      case 'rejected': return <Tag color="red">已拒绝</Tag>;
      default: return <Tag>{status}</Tag>;
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (name: string) => <Tag color="blue">{name}</Tag> },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (r: string) => r === 'student' ? <Tag>学生</Tag> : <Tag color="purple">教师</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: getStatusTag },
    { title: '申请时间', dataIndex: 'created_at', key: 'created_at', render: (t: string) => new Date(t).toLocaleString() },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        record.status === 'pending' ? (
          <Space>
            <Button type="primary" size="small" onClick={() => handleReview(record.id, 'approved')}>批准</Button>
            <Button danger size="small" onClick={() => handleReview(record.id, 'rejected')}>拒绝</Button>
          </Space>
        ) : getStatusTag(record.status)
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <Select
          placeholder="筛选班级"
          allowClear
          style={{ width: 200 }}
          onChange={(value) => setClassFilter(value)}
          value={classFilter}
        >
          {classes.map(c => (
            <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder="筛选状态"
          allowClear
          style={{ width: 120 }}
          onChange={(value) => setStatusFilter(value)}
          value={statusFilter}
        >
          <Select.Option value="pending">待审批</Select.Option>
          <Select.Option value="approved">已批准</Select.Option>
          <Select.Option value="rejected">已拒绝</Select.Option>
        </Select>
      </div>
      <Table columns={columns} dataSource={applications} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />
    </div>
  );
};

const TeacherManagement: React.FC = () => {
  const pagination = useTablePagination();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<any>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadTeachers();
  }, [statusFilter, searchText]);

  const loadTeachers = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getTeachers({ status: statusFilter || undefined, search: searchText || undefined });
      setTeachers(res.data.teachers || []);
    } catch (error) {
      message.error('加载教师列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (record: any) => {
    setEditingTeacher(record);
    form.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.updateTeacher(editingTeacher.id, values);
      message.success('教师信息更新成功');
      setEditModalVisible(false);
      loadTeachers();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleDelete = async (id: number, action: 'delete' | 'disable') => {
    try {
      await adminAPI.deleteTeacher(id, action);
      message.success(action === 'delete' ? '教师已删除' : '教师已禁用');
      loadTeachers();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
    { title: '最后登录', dataIndex: 'last_login', key: 'last_login', render: (v: string) => v ? new Date(v).toLocaleDateString() : '从未登录' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const map: any = { active: { color: 'green', text: '已激活' }, pending_approval: { color: 'warning', text: '待审批' }, disabled: { color: 'red', text: '已禁用' } };
        const s = map[status] || { color: 'default', text: status };
        return <Tag color={s.color}>{s.text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.status !== 'disabled' && (
            <Button type="link" danger onClick={() => handleDelete(record.id, 'disable')}>禁用</Button>
          )}
          <Popconfirm title="确定删除该教师？" onConfirm={() => handleDelete(record.id, 'delete')}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Input.Search placeholder="搜索教师" onSearch={setSearchText} style={{ width: 200 }} allowClear />
          <Select placeholder="筛选状态" style={{ width: 120 }} allowClear value={statusFilter || undefined} onChange={setStatusFilter}>
            <Select.Option value="active">已激活</Select.Option>
            <Select.Option value="pending_approval">待审批</Select.Option>
            <Select.Option value="disabled">已禁用</Select.Option>
          </Select>
          <Button onClick={loadTeachers}>刷新</Button>
        </Space>
      </div>
      <Table columns={columns} dataSource={teachers} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="编辑教师" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名"><Input /></Form.Item>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="pending_approval">待审批</Select.Option>
              <Select.Option value="disabled">已禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const StudentManagement: React.FC = () => {
  const pagination = useTablePagination();
  const isMobile = useMobile();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [classFilter, setClassFilter] = useState<number | undefined>();
  const [searchText, setSearchText] = useState('');
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [goldModalVisible, setGoldModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [studentDetail, setStudentDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const [goldForm] = Form.useForm();

  useEffect(() => {
    loadClasses();
    loadStudents();
  }, [statusFilter, classFilter, searchText]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级失败');
    }
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getStudents({ status: statusFilter || undefined, class_id: classFilter, search: searchText || undefined });
      setStudents(res.data.students || []);
    } catch (error) {
      message.error('加载学生列表失败');
    } finally {
      setLoading(false);
    }
  };

  const viewDetail = async (id: number) => {
    setDetailModalVisible(true);
    setSelectedStudent(students.find(s => s.id === id));
    try {
      const res = await adminAPI.getStudentDetail(id);
      setStudentDetail(res.data);
    } catch (error) {
      message.error('加载学生详情失败');
    }
  };

  const handleEdit = (record: any) => {
    setSelectedStudent(record);
    form.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.updateStudent(selectedStudent.id, values);
      message.success('学生信息更新成功');
      setEditModalVisible(false);
      loadStudents();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleGoldAdjust = async () => {
    try {
      const values = await goldForm.validateFields();
      await adminAPI.adjustStudentGold(selectedStudent.id, values.amount, values.reason);
      message.success('金币调整成功');
      setGoldModalVisible(false);
      goldForm.resetFields();
      loadStudents();
    } catch (error) {
      message.error('调整失败');
    }
  };

  const handleDelete = async (id: number, action: 'delete' | 'disable') => {
    try {
      await adminAPI.deleteStudent(id, action);
      message.success(action === 'delete' ? '学生已删除' : '学生已禁用');
      loadStudents();
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    }
  };

  const isHeadTeacherOfStudent = (record: any) => {
    if (isAdmin) return true;
    if (!user || user.role !== 'teacher') return false;
    const cls = classes.find((c: any) => c.id === record.class_id);
    if (!cls) return false;
    return cls.teachers?.some((t: any) => t.teacher_id === user.id && t.role === 'head_teacher');
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '未分配' },
    { title: '金币', dataIndex: 'gold', key: 'gold', render: (v: number) => <span style={{ color: '#faad14' }}>{v}</span> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const map: any = { active: { color: 'green', text: '已激活' }, disabled: { color: 'red', text: '已禁用' } };
        const s = map[status] || { color: 'default', text: status };
        return <Tag color={s.color}>{s.text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => {
        const canManage = isHeadTeacherOfStudent(record);
        return (
          <Space>
            <Button type="link" onClick={() => viewDetail(record.id)}>详情</Button>
            {canManage && (
              <>
                <Button type="link" onClick={() => { setSelectedStudent(record); goldForm.setFieldsValue({ amount: 0 }); setGoldModalVisible(true); }}>调金币</Button>
                <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
                {record.status !== 'disabled' && (
                  <Button type="link" danger onClick={() => handleDelete(record.id, 'disable')}>禁用</Button>
                )}
                <Popconfirm title="确定删除该学生？（包括其所有宠物和物品）" onConfirm={() => handleDelete(record.id, 'delete')}>
                  <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Input.Search placeholder="搜索学生" onSearch={setSearchText} style={{ width: 200 }} allowClear />
          <Select placeholder="筛选班级" style={{ width: 150 }} allowClear value={classFilter} onChange={setClassFilter}>
            {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
          </Select>
          <Select placeholder="筛选状态" style={{ width: 120 }} allowClear value={statusFilter || undefined} onChange={setStatusFilter}>
            <Select.Option value="active">已激活</Select.Option>
            <Select.Option value="disabled">已禁用</Select.Option>
          </Select>
          <Button onClick={loadStudents}>刷新</Button>
        </Space>
      </div>
      <Table columns={columns} dataSource={students} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="学生详情" open={detailModalVisible} onCancel={() => setDetailModalVisible(false)} footer={null} width={isMobile ? '95vw' : 800}>
        {studentDetail && (
          <div>
            <Descriptions bordered column={2}>
              <Descriptions.Item label="用户名">{studentDetail.student.username}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{studentDetail.student.email}</Descriptions.Item>
              <Descriptions.Item label="班级">{studentDetail.student.class_name || '未分配'}</Descriptions.Item>
              <Descriptions.Item label="金币"><span style={{ color: '#faad14' }}>{studentDetail.student.gold}</span></Descriptions.Item>
              <Descriptions.Item label="状态">{studentDetail.student.status}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{new Date(studentDetail.student.created_at).toLocaleDateString()}</Descriptions.Item>
            </Descriptions>
            <h4 style={{ marginTop: 16 }}>宠物 ({studentDetail.pets?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.pets || []} renderItem={(pet: any) => (
              <List.Item>
                <Space>
                  <span>{pet.name}</span>
                  <Tag>等级 {pet.level}</Tag>
                  <Tag color="blue">经验 {pet.exp}</Tag>
                </Space>
              </List.Item>
            )} />
            <h4 style={{ marginTop: 16 }}>物品 ({studentDetail.items?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.items || []} renderItem={(item: any) => (
              <List.Item>
                <Space>
                  <span>{item.name}</span>
                  <Tag>x{item.quantity}</Tag>
                </Space>
              </List.Item>
            )} />
            <h4 style={{ marginTop: 16 }}>装备 ({studentDetail.equipment?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.equipment || []} renderItem={(eq: any) => (
              <List.Item>
                <Space>
                  <span>{eq.name}</span>
                  <Tag color={eq.rarity === 'rare' ? 'purple' : eq.rarity === 'epic' ? 'red' : 'blue'}>{eq.rarity}</Tag>
                  <Tag>等级 {eq.level}</Tag>
                </Space>
              </List.Item>
            )} />
          </div>
        )}
      </Modal>

      <Modal title="编辑学生" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名"><Input /></Form.Item>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="class_id" label="班级">
            <Select allowClear onChange={v => form.setFieldValue('class_id', v)}>
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="disabled">已禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="调整金币" open={goldModalVisible} onOk={handleGoldAdjust} onCancel={() => setGoldModalVisible(false)}>
        <Form form={goldForm} layout="vertical">
          <Form.Item name="amount" label="金币调整量（正数增加，负数减少）" rules={[{ required: true, message: '请输入调整量' }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="原因（可选）"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const ClassManagement: React.FC = () => {
  const pagination = useTablePagination();
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [addTeacherModalVisible, setAddTeacherModalVisible] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [addTeacherForm] = Form.useForm();

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  useEffect(() => {
    loadClasses();
    loadTeachers();
  }, []);

  const loadClasses = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getClasses();
      let allClasses = res.data.classes || [];
      if (isTeacher && !isAdmin) {
        allClasses = allClasses.filter((c: any) =>
          c.teachers?.some((t: any) => t.teacher_id === user?.id)
        );
      }
      setClasses(allClasses);
    } catch (error) {
      message.error('加载班级列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTeachers = async () => {
    try {
      const res = await adminAPI.getTeachers({ status: 'active' });
      setTeachers(res.data.teachers || []);
    } catch (error) {
      console.error('加载教师列表失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.createClass(values);
      message.success('班级创建成功');
      setModalVisible(false);
      form.resetFields();
      loadClasses();
    } catch (error) {
      message.error('创建失败');
    }
  };

  const handleEdit = (record: any) => {
    setSelectedClass(record);
    editForm.setFieldsValue({
      name: record.name,
      grade: record.grade,
      description: record.description || '',
      cover_image: record.cover_image || '',
      is_public: !!record.is_public,
      slug: record.slug || '',
      school_id: record.school_id || null,
    });
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await editForm.validateFields();
      await adminAPI.updateClass(selectedClass.id, values);
      message.success('班级更新成功');
      setEditModalVisible(false);
      loadClasses();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await adminAPI.deleteClass(id);
      message.success('班级已删除');
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    }
  };

  const handleAddTeacher = async () => {
    try {
      const values = await addTeacherForm.validateFields();
      await adminAPI.addTeacherToClass(selectedClass.id, values);
      message.success('教师已添加到班级');
      setAddTeacherModalVisible(false);
      addTeacherForm.resetFields();
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '添加失败');
    }
  };

  const handleRemoveTeacher = async (classId: number, teacherId: number) => {
    try {
      await adminAPI.removeTeacherFromClass(classId, teacherId);
      message.success('教师已从班级移除');
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '移除失败');
    }
  };

  const openAddTeacherModal = (cls: any) => {
    setSelectedClass(cls);
    setAddTeacherModalVisible(true);
  };

  const isHeadTeacherOf = (cls: any) => {
    return cls.teachers?.some((t: any) => t.teacher_id === user?.id && t.role === 'head_teacher');
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '班级名称', dataIndex: 'name', key: 'name' },
    { title: '年级', dataIndex: 'grade', key: 'grade', render: (v: string) => v || '-' },
    ...(isAdmin ? [{ title: '学校', dataIndex: 'school_name', key: 'school_name', render: (v: string) => v || '-' }] : []),
    { title: '标识(slug)', dataIndex: 'slug', key: 'slug', render: (v: string) => v ? <code>{v}</code> : '-' },
    { title: '公开', dataIndex: 'is_public', key: 'is_public', render: (v: any) => v ? <Tag color="green">公开</Tag> : <Tag>私有</Tag> },
    {
      title: '教师',
      key: 'teachers',
      render: (_: any, record: any) => (
        <div>
          {(record.teachers || []).map((t: any) => (
            <Tag
              key={t.teacher_id}
              closable={(isAdmin || isHeadTeacherOf(record)) && t.role !== 'head_teacher'}
              onClose={() => (isAdmin || isHeadTeacherOf(record)) && t.role !== 'head_teacher' ? handleRemoveTeacher(record.id, t.teacher_id) : undefined}
              color={t.role === 'head_teacher' ? 'blue' : 'default'}
            >
              {t.username} {t.role === 'head_teacher' ? '(班主任)' : ''}
            </Tag>
          ))}
          {(isAdmin || isHeadTeacherOf(record)) && (
            <Button type="link" size="small" onClick={() => openAddTeacherModal(record)}>+ 添加教师</Button>
          )}
        </div>
      )
    },
    { title: '学生数', dataIndex: 'student_count', key: 'student_count' },
    ...(isAdmin ? [{ title: '总经验', dataIndex: 'total_exp', key: 'total_exp' }] : []),
    ...(isAdmin ? [{ title: '金币总数', dataIndex: 'total_gold', key: 'total_gold' }] : []),
    ...(isAdmin ? [{
      title: '操作' as const,
      key: 'action' as const,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该班级？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      {isAdmin && (
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>创建班级</Button>
        </div>
      )}
      <Table columns={columns} dataSource={classes} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="创建班级" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input placeholder="如：高一(1)班" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑班级" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={isMobile ? '95vw' : 560}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="班级简介">
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
          <Form.Item name="cover_image" label="封面图 URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="is_public" label="公开班级主页" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="slug"
            label="班级标识 (slug)"
            rules={[
              { pattern: /^[a-z0-9][a-z0-9-]{2,31}$/i, message: '3-32 位字母/数字/连字符，首字符为字母或数字' },
            ]}
          >
            <Input placeholder="例：class3-grade2" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`为班级「${selectedClass?.name}」添加教师`} open={addTeacherModalVisible} onOk={handleAddTeacher} onCancel={() => setAddTeacherModalVisible(false)}>
        <Form form={addTeacherForm} layout="vertical" initialValues={{ role: 'teacher' }}>
          <Form.Item name="teacher_id" label="选择教师" rules={[{ required: true, message: '请选择教师' }]}>
            <Select placeholder="选择要添加的教师" filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}>
              {teachers
                .filter(t => !selectedClass?.teachers?.some((ct: any) => ct.teacher_id === t.id))
                .map(t => <Select.Option key={t.id} value={t.id} label={t.username}>{t.username}</Select.Option>)
              }
            </Select>
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select>
              <Select.Option value="head_teacher">班主任</Select.Option>
              <Select.Option value="teacher">任课教师</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const SchoolManagement: React.FC = () => {
  const pagination = useTablePagination();
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSchool, setEditingSchool] = useState<any>(null);
  const [form] = Form.useForm();

  useEffect(() => { loadSchools(); }, []);

  const loadSchools = async () => {
    setLoading(true);
    try {
      const res = await schoolAPI.getSchools();
      setSchools(res.data.schools || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载学校列表失败');
    } finally { setLoading(false); }
  };

  const openCreate = () => {
    setEditingSchool(null);
    form.resetFields();
    form.setFieldsValue({ theme_color: '#1677ff' });
    setModalVisible(true);
  };

  const openEdit = (record: any) => {
    setEditingSchool(record);
    form.setFieldsValue({
      name: record.name,
      city: record.city,
      region: record.region,
      theme_color: record.theme_color || '#1677ff',
      logo: record.logo || '',
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingSchool) {
        await schoolAPI.updateSchool(editingSchool.id, values);
        message.success('学校更新成功');
      } else {
        await schoolAPI.createSchool(values);
        message.success('学校创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      loadSchools();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await schoolAPI.deleteSchool(id);
      message.success('学校已删除');
      loadSchools();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '城市', dataIndex: 'city', key: 'city', render: (v: string) => v || '-' },
    { title: '区域', dataIndex: 'region', key: 'region', render: (v: string) => v || '-' },
    { title: '主题色', dataIndex: 'theme_color', key: 'theme_color', render: (v: string) => v
      ? <Space><span style={{ display: 'inline-block', width: 16, height: 16, background: v, borderRadius: 3, border: '1px solid #eee' }} /><span>{v}</span></Space>
      : '-' },
    { title: '班级数', dataIndex: 'class_count', key: 'class_count' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="删除后不可恢复，仅在该学校下无班级时才能删除。确认删除？"
            onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建学校</Button>
      </div>
      <Table columns={columns} dataSource={schools} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal
        title={editingSchool ? '编辑学校' : '新建学校'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="学校名称" rules={[{ required: true, message: '请输入学校名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="city" label="城市"><Input /></Form.Item>
          <Form.Item name="region" label="区域"><Input /></Form.Item>
          <Form.Item name="theme_color" label="主题色">
            <Input type="color" style={{ width: 120, padding: 2 }} />
          </Form.Item>
          <Form.Item name="logo" label="Logo URL"><Input placeholder="https://..." /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const AnnouncementManagement: React.FC = () => {
  const pagination = useTablePagination();
  const isMobile = useMobile();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    loadAnnouncements();
    loadClasses();
  }, []);

  const loadAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getAnnouncements();
      setAnnouncements(res.data.announcements || []);
    } catch (error) {
      message.error('加载公告失败');
    } finally {
      setLoading(false);
    }
  };

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.createAnnouncement(values);
      message.success('公告创建成功');
      setModalVisible(false);
      form.resetFields();
      loadAnnouncements();
    } catch (error) {
      message.error('创建失败');
    }
  };

  const handleEdit = (record: any) => {
    setEditingAnnouncement(record);
    editForm.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await editForm.validateFields();
      await adminAPI.updateAnnouncement(editingAnnouncement.id, values);
      message.success('公告更新成功');
      setEditModalVisible(false);
      loadAnnouncements();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await adminAPI.deleteAnnouncement(id);
      message.success('公告已删除');
      loadAnnouncements();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '发布者', dataIndex: 'publisher_name', key: 'publisher_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '全局' },
    { title: '优先级', dataIndex: 'priority', key: 'priority' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该公告？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>发布公告</Button>
      </div>
      <Table columns={columns} dataSource={announcements} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="发布公告" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)} width={isMobile ? '95vw' : 600}>
        <Form form={form} layout="vertical" initialValues={{ priority: 0 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="class_ids" label="发布范围">
            <Select mode="multiple" allowClear placeholder="选择班级（不选则全局发布）">
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑公告" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={isMobile ? '95vw' : 600}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="class_id" label="发布范围">
            <Select allowClear placeholder="选择班级">
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const SiteSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getSiteSettings();
      const data = res.data.settings || {};
      form.setFieldsValue({
        site_name: data.site_name || '班级宠物养成系统',
        site_description: data.site_description || '寓教于乐，让学习更有趣',
        site_logo: data.site_logo || '🐾',
        site_footer: data.site_footer || '© 2026 班级宠物养成系统',
        site_announcement: data.site_announcement || '',
        registration_enabled: data.registration_enabled === 'true',
        battle_enabled: data.battle_enabled === 'true',
        shop_enabled: data.shop_enabled === 'true',
        max_pets_per_user: parseInt(data.max_pets_per_user) || 1,
        daily_login_gold: parseInt(data.daily_login_gold) || 10,
        battle_stamina_cost: parseInt(data.battle_stamina_cost) || 20,
        perm_battle_records: data.perm_battle_records || 'head_teacher',
        perm_homework_records: data.perm_homework_records || 'subject_teacher',
        perm_purchase_records: data.perm_purchase_records || 'head_teacher',
      });
    } catch (error) {
      message.error('加载网站设置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      const data = {
        ...values,
        registration_enabled: String(values.registration_enabled),
        battle_enabled: String(values.battle_enabled),
        shop_enabled: String(values.shop_enabled),
      };
      await adminAPI.saveSiteSettings(data);
      message.success('网站设置已保存');
      loadSettings();
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <Alert
        message="网站设置"
        description="修改网站设置后，前端页面将实时生效。请谨慎修改功能开关。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Card title={<span><GlobalOutlined /> 基本设置</span>} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="site_name" label="站点名称" rules={[{ required: true, message: '请输入站点名称' }]}>
                <Input placeholder="班级宠物养成系统" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="site_logo" label="站点Logo（Emoji）" rules={[{ required: true, message: '请输入Logo' }]}>
                <Input placeholder="🐾" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="site_description" label="站点描述">
            <Input placeholder="寓教于乐，让学习更有趣" />
          </Form.Item>
          <Form.Item name="site_footer" label="底部版权信息">
            <Input placeholder="© 2026 班级宠物养成系统" />
          </Form.Item>
          <Form.Item name="site_announcement" label="全局公告">
            <Input.TextArea rows={2} placeholder="输入公告内容，留空则不显示公告栏" />
          </Form.Item>
        </Card>

        <Card title={<span><SafetyOutlined /> 功能开关</span>} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="registration_enabled" label="开放注册" valuePropName="checked">
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="battle_enabled" label="宠物战斗" valuePropName="checked">
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="shop_enabled" label="道具商店" valuePropName="checked">
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title={<span><ThunderboltOutlined /> 游戏参数</span>} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="max_pets_per_user" label="每用户最大宠物数">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="daily_login_gold" label="每日登录金币奖励">
                <InputNumber min={0} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="battle_stamina_cost" label="战斗体力消耗">
                <InputNumber min={0} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title={<span><SafetyOutlined /> 数据查看权限</span>} style={{ marginBottom: 16 }}>
          <Alert
            message="权限说明"
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li><b>仅班主任</b>：只有班主任可以查看</li>
                <li><b>任课教师</b>：任课教师可以查看自己任教班级的数据，班主任可查看所有</li>
                <li><b>所有教师</b>：所有教师均可查看任教班级的数据</li>
              </ul>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="perm_battle_records" label="战斗记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="perm_homework_records" label="作业记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="perm_purchase_records" label="购买记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} size="large">
            保存所有设置
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

const AISettings: React.FC = () => {
  const [settingsForm] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getSiteSettings();
      const data = res.data.settings || {};
      settingsForm.setFieldsValue({
        ai_model: data.ai_model || 'gpt-3.5-turbo',
        ai_base_url: data.ai_base_url || 'https://api.openai.com/v1',
        ai_api_key: data.ai_api_key || '',
        ai_report_interval_days: data.ai_report_interval_days || '3',
      });
    } catch (error) {
      message.error('加载设置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      await adminAPI.saveSiteSettings(values);
      message.success('大模型设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title={<span><RobotOutlined /> AI 大模型配置</span>} style={{ maxWidth: 600 }}>
      <Alert
        message="AI设置说明"
        description="配置AI大模型接口后，系统可以使用AI出题、智能分析等功能。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={settingsForm} layout="vertical" onFinish={handleSave}>
        <Form.Item name="ai_model" label="大模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
          <Input placeholder="如 gpt-3.5-turbo" />
        </Form.Item>
        <Form.Item name="ai_base_url" label="API Base URL" rules={[{ required: true, message: '请输入API地址' }]}>
          <Input placeholder="如 https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="ai_api_key" label="API Key" rules={[{ required: true, message: '请输入API Key' }]}>
          <Input.Password placeholder="输入 API 密钥" />
        </Form.Item>
        <Form.Item name="ai_report_interval_days" label="AI报告重新生成间隔（天）" rules={[{ required: true, message: '请输入间隔天数' }]} extra="学生生成学习规划或诊断报告后，需间隔多少天才可重新生成。默认3天。">
          <Input type="number" min={1} max={30} placeholder="3" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

const DataView: React.FC = () => {
  const { user } = useAuthStore();
  const battlePagination = useTablePagination();
  const assignmentPagination = useTablePagination();
  const shopPagination = useTablePagination();
  const [battles, setBattles] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [shopRecords, setShopRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('assignments');
  const [questionModalVisible, setQuestionModalVisible] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [assignmentQuestions, setAssignmentQuestions] = useState<any[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isHeadTeacher = user?.role === 'teacher' && (user as any).teacher_classes?.some(
    (c: any) => c.class_role === 'head_teacher'
  );

  const canViewBattles = isAdmin || isHeadTeacher;
  const canViewShop = isAdmin || isHeadTeacher;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'battles' && !canViewBattles) {
      setActiveTab('assignments');
    }
    if (activeTab === 'shop' && !canViewShop) {
      setActiveTab('assignments');
    }
  }, [canViewBattles, canViewShop]);

  const loadData = async () => {
    setLoading(true);
    try {
      const promises: Promise<any>[] = [];
      if (canViewBattles) promises.push(adminAPI.getBattles());
      promises.push(adminAPI.getAssignments());
      if (canViewShop) promises.push(adminAPI.getShopRecords());

      const results = await Promise.all(promises);
      let idx = 0;
      if (canViewBattles) {
        setBattles(results[idx].data.battles || []);
        idx++;
      }
      setAssignments(results[idx].data.assignments || []);
      idx++;
      if (canViewShop) {
        setShopRecords(results[idx].data.records || []);
      }
    } catch (error: any) {
      if (error?.response?.status === 403) {
        message.warning('部分数据无权查看');
      } else {
        message.error('加载数据失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewQuestions = async (record: any) => {
    setSelectedAssignment(record);
    setQuestionModalVisible(true);
    setQuestionsLoading(true);
    try {
      const res = await assignmentAPI.getAssignment(record.id);
      setAssignmentQuestions(res.data.assignment?.questions || []);
    } catch (e: any) {
      message.error('加载题目失败');
    } finally {
      setQuestionsLoading(false);
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    try {
      await adminAPI.deleteAssignment(id);
      message.success('作业及相关数据已彻底删除');
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const handleDeleteQuestion = async (questionId: number) => {
    if (!selectedAssignment) return;
    try {
      await adminAPI.deleteAssignmentQuestion(selectedAssignment.id, questionId);
      message.success('题目及相关记录已删除');
      handleViewQuestions(selectedAssignment);
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除题目失败');
    }
  };

  const battleColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '挑战者', dataIndex: 'challenger_name', key: 'challenger_name' },
    { title: '应战者', dataIndex: 'defender_name', key: 'defender_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '结果', dataIndex: 'winner_id', key: 'winner_id', render: (v: number, record: any) => v === record.pet1_id ? '挑战者胜' : v === record.pet2_id ? '应战者胜' : '-' },
    { title: '时间', dataIndex: 'battle_date', key: 'battle_date', render: (v: string) => new Date(v).toLocaleString() },
  ];

  const assignmentColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '创建人', dataIndex: 'creator_name', key: 'creator_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        if (status === 'cancelled') return <Tag color="default">已取消</Tag>;
        return <Tag color="green">进行中</Tag>;
      }
    },
    { title: '经验奖励', dataIndex: 'max_exp', key: 'max_exp' },
    { title: '截止日期', dataIndex: 'due_date', key: 'due_date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewQuestions(record)}>查看题目</Button>
          {record.status === 'cancelled' && isAdmin && (
            <Popconfirm
              title="确认彻底删除此作业？"
              description="将删除作业、题目、提交记录、错题本等所有相关数据，不可恢复"
              onConfirm={() => handleDeleteAssignment(record.id)}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const shopColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '购买者', dataIndex: 'buyer_name', key: 'buyer_name' },
    { title: '商品', dataIndex: 'item_name', key: 'item_name' },
    { title: '稀有度', dataIndex: 'rarity', key: 'rarity', render: (v: string) => <Tag color={
      v === 'legendary' ? 'gold' : v === 'epic' ? 'purple' : v === 'rare' ? 'blue' : v === 'uncommon' ? 'green' : 'default'
    }>{v}</Tag> },
    { title: '数量', dataIndex: 'quantity', key: 'quantity' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '时间', dataIndex: 'obtained_at', key: 'obtained_at', render: (v: string) => new Date(v).toLocaleString() },
  ];

  const dataViewTabItems = [
    ...(canViewBattles ? [{ key: 'battles', label: '战斗记录', children: <Table dataSource={battles} columns={battleColumns} rowKey="id" loading={loading} pagination={battlePagination} size="small" scroll={{ x: true }} /> }] : []),
    { key: 'assignments', label: '作业记录', children: <Table dataSource={assignments} columns={assignmentColumns} rowKey="id" loading={loading} pagination={assignmentPagination} size="small" scroll={{ x: true }} /> },
    ...(canViewShop ? [{ key: 'shop', label: '购买记录', children: <Table dataSource={shopRecords} columns={shopColumns} rowKey="id" loading={loading} pagination={shopPagination} size="small" scroll={{ x: true }} /> }] : []),
  ];

  return (
    <div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={dataViewTabItems} />

      <Modal
        title={`题目详情 - ${selectedAssignment?.title || ''}`}
        open={questionModalVisible}
        onCancel={() => { setQuestionModalVisible(false); setSelectedAssignment(null); setAssignmentQuestions([]); }}
        width={700}
        footer={<Button onClick={() => setQuestionModalVisible(false)}>关闭</Button>}
      >
        {selectedAssignment?.status === 'cancelled' && isAdmin && (
          <Alert
            type="warning"
            showIcon
            message="此作业已取消，管理员可以删除其中的题目（将同时删除相关错题本、答题记录等）"
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          dataSource={assignmentQuestions}
          rowKey="id"
          loading={questionsLoading}
          pagination={false}
          size="small"
          columns={[
            { title: '#', render: (_: any, __: any, i: number) => i + 1, width: 40 },
            { title: '题型', dataIndex: 'type', key: 'type', width: 80, render: (t: string) => {
              const map: Record<string, string> = { choice_single: '单选', choice_multi: '多选', judgment: '判断', essay: '主观', fill_blank: '填空' };
              return <Tag>{map[t] || t}</Tag>;
            }},
            { title: '题目内容', dataIndex: 'content', key: 'content', render: (c: string) => (
              <div style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>
            )},
            { title: '知识点', dataIndex: 'knowledge_point', key: 'knowledge_point', width: 140, render: (kp: string) => kp ? <Tag color="blue">{kp}</Tag> : '-' },
            ...(selectedAssignment?.status === 'cancelled' && isAdmin ? [{
              title: '操作',
              key: 'action',
              width: 80,
              render: (_: any, record: any) => (
                <Popconfirm
                  title="确认删除此题目？"
                  description="将同时删除相关答题记录、错题本记录等"
                  onConfirm={() => handleDeleteQuestion(record.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ),
            }] : []),
          ]}
        />
      </Modal>
    </div>
  );
};

export default Admin;