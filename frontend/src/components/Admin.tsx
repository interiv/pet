import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tabs, Form, Input, message, Tag, Space, Modal, Select, InputNumber, Popconfirm, Row, Col, Statistic, List, Descriptions, Badge } from 'antd';
import { UserOutlined, TeamOutlined, FolderOutlined, NotificationOutlined, SettingOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminAPI } from '../utils/api';

const { TabPane } = Tabs;

const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>管理控制台</h2>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane tab={<span><TeamOutlined /> 总览</span>} key="dashboard">
          <Dashboard />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span><UserOutlined /> 教师管理</span>} key="teachers">
          <TeacherManagement />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span><TeamOutlined /> 学生管理</span>} key="students">
          <StudentManagement />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span><FolderOutlined /> 班级管理</span>} key="classes">
          <ClassManagement />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span><NotificationOutlined /> 公告管理</span>} key="announcements">
          <AnnouncementManagement />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span><SettingOutlined /> AI设置</span>} key="settings">
          <AISettings />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const [statistics, setStatistics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  const [detailLoading, setDetailLoading] = useState(false);
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
    setDetailLoading(true);
    setDetailModalVisible(true);
    setSelectedStudent(students.find(s => s.id === id));
    try {
      const res = await adminAPI.getStudentDetail(id);
      setStudentDetail(res.data);
    } catch (error) {
      message.error('加载学生详情失败');
    } finally {
      setDetailLoading(false);
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
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingClass, setEditingClass] = useState<any>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    loadClasses();
    loadTeachers();
  }, []);

  const loadClasses = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
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
    setEditingClass(record);
    editForm.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await editForm.validateFields();
      await adminAPI.updateClass(editingClass.id, values);
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

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '班级名称', dataIndex: 'name', key: 'name' },
    { title: '年级', dataIndex: 'grade', key: 'grade', render: (v: string) => v || '-' },
    { title: '班主任', dataIndex: 'teacher_name', key: 'teacher_name', render: (v: string) => v || <Tag>未分配</Tag> },
    { title: '学生数', dataIndex: 'student_count', key: 'student_count' },
    { title: '总经验', dataIndex: 'total_exp', key: 'total_exp' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该班级？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>创建班级</Button>
      </div>
      <Table columns={columns} dataSource={classes} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

      <Modal title="创建班级" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input placeholder="如：高一(1)班" />
          </Form.Item>
          <Form.Item name="teacher_id" label="班主任">
            <Select allowClear placeholder="选择班主任">
              {teachers.map(t => <Select.Option key={t.id} value={t.id}>{t.username}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑班级" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input />
          </Form.Item>
          <Form.Item name="teacher_id" label="班主任">
            <Select allowClear placeholder="选择班主任">
              {teachers.map(t => <Select.Option key={t.id} value={t.id}>{t.username}</Select.Option>)}
            </Select>
          </Form.Item>
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
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="class_id" label="发布范围">
            <Select allowClear placeholder="选择班级（不选则全局发布）">
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={10} defaultValue={0} style={{ width: '100%' }} />
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

const AISettings: React.FC = () => {
  const [settingsForm] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getAISettings();
      settingsForm.setFieldsValue(res.data.settings);
    } catch (error) {
      message.error('加载设置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      await adminAPI.saveAISettings(values);
      message.success('大模型设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ maxWidth: 600 }}>
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

export default Admin;