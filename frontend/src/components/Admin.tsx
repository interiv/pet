import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tabs, Form, Input, message, Tag, Space, Modal, Select, InputNumber, Popconfirm, Row, Col, Statistic, List, Descriptions, Badge, Switch, Alert } from 'antd';
import { UserOutlined, TeamOutlined, FolderOutlined, NotificationOutlined, DeleteOutlined, EditOutlined, PlusOutlined, DollarOutlined, DatabaseOutlined, GlobalOutlined, SafetyOutlined, ThunderboltOutlined, RobotOutlined, BankOutlined } from '@ant-design/icons';
import { adminAPI, schoolAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

interface AdminProps {
  defaultTab?: string;
}

const Admin: React.FC<AdminProps> = ({ defaultTab }) => {
  const { user } = useAuthStore();
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
      ];
    } else if (isTeacher) {
      return [
        { key: 'dashboard', label: <span><TeamOutlined /> 总览</span>, children: <Dashboard /> },
        { key: 'students', label: <span><TeamOutlined /> 学生管理</span>, children: <StudentManagement /> },
        { key: 'classes', label: <span><FolderOutlined /> 班级管理</span>, children: <ClassManagement /> },
        { key: 'applications', label: <span><TeamOutlined /> 入学申请</span>, children: <ApplicationManagement /> },
        { key: 'dataview', label: <span><DatabaseOutlined /> 数据查看</span>, children: <DataView /> },
      ];
    }
    return [];
  };

  const getTitle = () => {
    if (isAdmin) return '管理控制台';
    if (isTeacher) return '教师工作台';
    return '控制台';
  };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>{getTitle()}</h2>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={getTabItems()} />
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [statistics, setStatistics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getStatistics();
      setStatistics(res.data.statistics);
    } catch (error) {
      message.error('加载统计数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (!statistics) return null;

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

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="总用户数" value={statistics.users.total} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="教师数" value={statistics.users.teachers} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="学生数" value={statistics.users.students} prefix={<TeamOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="班级数" value={statistics.classes.total} prefix={<FolderOutlined />} /></Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="宠物总数" value={statistics.pets.total} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="战斗总数" value={statistics.battles.total} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="金币总量" value={statistics.totals.gold} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="经验总量" value={statistics.totals.exp} /></Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card><Statistic title="当日活跃用户" value={statistics.daily?.active_users || 0} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="当日金币发放" value={statistics.daily?.gold_distributed || 0} prefix={<DollarOutlined />} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="当日金币消耗" value={statistics.daily?.gold_consumed || 0} prefix={<DollarOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="待审批教师" loading={loading}>
            <Tag color="warning">{statistics.status.pending_teachers} 人待审批</Tag>
            <Tag color="success">{statistics.status.active_teachers} 人已激活</Tag>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="最近注册">
            <List
              size="small"
              dataSource={statistics.recent_registrations}
              renderItem={(item: any) => (
                <List.Item>
                  <Space>
                    <span>{item.username}</span>
                    <Tag color={item.role === 'teacher' ? 'blue' : 'green'}>{item.role === 'teacher' ? '教师' : '学生'}</Tag>
                    <span style={{ color: '#999' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="班级排行榜">
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
                    <Tag color="green">总经验: {item.total_exp}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="商品销售排行">
            <Table
              dataSource={statistics.top_selling_items}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: '排名', render: (_: any, __: any, index: number) => index + 1 },
                { title: '商品名称', dataIndex: 'name', key: 'name' },
                { title: '稀有度', dataIndex: 'rarity', key: 'rarity', render: (v: string) => <Tag color={
                  v === 'legendary' ? 'gold' :
                  v === 'epic' ? 'purple' :
                  v === 'rare' ? 'blue' :
                  v === 'uncommon' ? 'green' : 'default'
                }>{v}</Tag> },
                { title: '购买次数', dataIndex: 'purchase_count', key: 'purchase_count' },
                { title: '总数量', dataIndex: 'total_quantity', key: 'total_quantity' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

const ApplicationManagement: React.FC = () => {
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
          c.teachers?.some((t: any) => t.teacher_id === user?.id)
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
      <Table columns={columns} dataSource={applications} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
    </div>
  );
};

const TeacherManagement: React.FC = () => {
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
      <Table columns={columns} dataSource={teachers} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

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
    } catch (error) {
      message.error('操作失败');
    }
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
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" onClick={() => viewDetail(record.id)}>详情</Button>
          <Button type="link" onClick={() => { setSelectedStudent(record); goldForm.setFieldsValue({ amount: 0 }); setGoldModalVisible(true); }}>调金币</Button>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.status !== 'disabled' && (
            <Button type="link" danger onClick={() => handleDelete(record.id, 'disable')}>禁用</Button>
          )}
          <Popconfirm title="确定删除该学生？（包括其所有宠物和物品）" onConfirm={() => handleDelete(record.id, 'delete')}>
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
      <Table columns={columns} dataSource={students} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

      <Modal title="学生详情" open={detailModalVisible} onCancel={() => setDetailModalVisible(false)} footer={null} width={800}>
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
  const { user } = useAuthStore();
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
              closable={isAdmin || isHeadTeacherOf(record)}
              onClose={() => (isAdmin || isHeadTeacherOf(record)) ? handleRemoveTeacher(record.id, t.teacher_id) : undefined}
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
      <Table columns={columns} dataSource={classes} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

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

      <Modal title="编辑班级" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={560}>
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
      <Table columns={columns} dataSource={schools} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

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
      <Table columns={columns} dataSource={announcements} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

      <Modal title="发布公告" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)} width={600}>
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

      <Modal title="编辑公告" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={600}>
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
        site_footer: data.site_footer || '© 2024 班级宠物养成系统',
        site_announcement: data.site_announcement || '',
        registration_enabled: data.registration_enabled === 'true',
        battle_enabled: data.battle_enabled === 'true',
        shop_enabled: data.shop_enabled === 'true',
        max_pets_per_user: parseInt(data.max_pets_per_user) || 1,
        daily_login_gold: parseInt(data.daily_login_gold) || 10,
        battle_stamina_cost: parseInt(data.battle_stamina_cost) || 20,
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
            <Input placeholder="© 2024 班级宠物养成系统" />
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
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

const DataView: React.FC = () => {
  const [battles, setBattles] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [shopRecords, setShopRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('battles');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [battlesRes, assignmentsRes, recordsRes] = await Promise.all([
        adminAPI.getBattles(),
        adminAPI.getAssignments(),
        adminAPI.getShopRecords(),
      ]);
      setBattles(battlesRes.data.battles || []);
      setAssignments(assignmentsRes.data.assignments || []);
      setShopRecords(recordsRes.data.records || []);
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
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
    { title: '经验奖励', dataIndex: 'max_exp', key: 'max_exp' },
    { title: '截止日期', dataIndex: 'due_date', key: 'due_date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
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
    { key: 'battles', label: '战斗记录', children: <Table dataSource={battles} columns={battleColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="small" /> },
    { key: 'assignments', label: '作业记录', children: <Table dataSource={assignments} columns={assignmentColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="small" /> },
    { key: 'shop', label: '购买记录', children: <Table dataSource={shopRecords} columns={shopColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="small" /> },
  ];

  return (
    <div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={dataViewTabItems} />
    </div>
  );
};

export default Admin;