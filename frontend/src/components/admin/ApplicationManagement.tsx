import React, { useEffect, useState } from 'react';
import { Table, Button, Tabs, message, Tag, Space, Select, Badge, Alert } from 'antd';
import { adminAPI } from '../../utils/api';
import { useAuthStore } from '../../store/authStore';
import { useTablePagination } from './hooks';

const ApplicationManagement: React.FC<{
  initialRole?: 'teacher' | 'student';
  initialStatus?: string;
}> = ({ initialRole, initialStatus }) => {
  const pagination = useTablePagination();
  const { user } = useAuthStore();
  const [applications, setApplications] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus !== undefined ? initialStatus : 'pending');
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const [roleTab, setRoleTab] = useState<'teacher' | 'student'>(initialRole || 'teacher');

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  useEffect(() => {
    loadApplications();
    loadClasses();
  }, [classFilter]);

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
      // 只按班级向后端筛选；身份（教师/学生）与状态在前端过滤，
      // 这样两个子页签上的"待审批"数量始终准确
      const params: any = {};
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
      const res = await adminAPI.reviewClassApplication(id, { status });
      message.success(res.data?.message || (status === 'approved' ? '已批准该申请' : '已拒绝该申请'));
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
    {
      title: '姓名',
      dataIndex: 'real_name',
      key: 'username',
      render: (v: string, r: any) => v
        ? (<span>{v}<br /><span style={{ color: '#999', fontSize: 12 }}>{r.username}</span></span>)
        : (r.username || <span style={{ color: '#bbb' }}>—</span>),
    },
    {
      title: '身份',
      dataIndex: 'role',
      key: 'role',
      render: (r: string, record: any) => r === 'student'
        ? <Tag>学生</Tag>
        : record.teacher_type === 'head_teacher' ? <Tag color="purple">班主任</Tag> : <Tag color="geekblue">任课教师</Tag>
    },
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

  // 按身份拆分为「教师申请」与「学生申请」两组
  const teacherApplications = applications.filter((a: any) => a.role !== 'student');
  const studentApplications = applications.filter((a: any) => a.role === 'student');
  const filterByStatus = (list: any[]) => (statusFilter ? list.filter((a) => a.status === statusFilter) : list);
  const pendingCount = (list: any[]) => list.filter((a) => a.status === 'pending').length;
  const teacherPending = pendingCount(teacherApplications);
  const studentPending = pendingCount(studentApplications);

  const tabLabel = (text: string, count: number) => (
    <span>
      {text}
      {count > 0 && <Badge count={count} size="small" style={{ marginLeft: 6 }} />}
    </span>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Select
          placeholder="筛选班级"
          allowClear
          style={{ width: 200 }}
          onChange={(value) => setClassFilter(value ?? null)}
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
          onChange={(value) => setStatusFilter(value || '')}
          value={statusFilter}
        >
          <Select.Option value="pending">待审批</Select.Option>
          <Select.Option value="approved">已批准</Select.Option>
          <Select.Option value="rejected">已拒绝</Select.Option>
        </Select>
        <Button onClick={loadApplications}>刷新</Button>
      </div>

      <Tabs
        activeKey={roleTab}
        onChange={(key) => setRoleTab(key as 'teacher' | 'student')}
        items={[
          {
            key: 'teacher',
            label: tabLabel('教师申请', teacherPending),
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="教师申请说明"
                  description="「班主任」申请通过后，该教师将成为所选班级的班主任；「任课教师」申请通过后，将以普通教师身份加入所选班级。"
                />
                <Table
                  columns={columns}
                  dataSource={filterByStatus(teacherApplications)}
                  rowKey="id"
                  loading={loading}
                  pagination={pagination}
                  scroll={{ x: true }}
                />
              </div>
            ),
          },
          {
            key: 'student',
            label: tabLabel('学生申请', studentPending),
            children: (
              <Table
                columns={columns}
                dataSource={filterByStatus(studentApplications)}
                rowKey="id"
                loading={loading}
                pagination={pagination}
                scroll={{ x: true }}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export { ApplicationManagement };
export default ApplicationManagement;
