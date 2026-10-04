import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, Tabs, Avatar, Table, Tag, Select, Alert, Empty } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, WalletOutlined, PlusOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { authAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import TransactionPanel from './TransactionPanel';
import { useMobile } from './admin/hooks';
import { SUBJECT_OPTIONS } from '../utils/subjects';

const Profile: React.FC = () => {
  const { user, checkAuth } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  // 只有学生会用到金币与背包体系，教师/管理员不显示「资产明细」页签
  const isStudent = user?.role === 'student';
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  // ===== 任教信息（教师/管理员） =====
  const [subjectDraft, setSubjectDraft] = useState<Record<number, string>>({});
  const [subjectSaving, setSubjectSaving] = useState(false);
  const [teachable, setTeachable] = useState<any[]>([]);
  const [joinForm] = Form.useForm();
  const [joinLoading, setJoinLoading] = useState(false);

  const myClasses = user?.teacher_classes || [];

  useEffect(() => {
    if (!isTeacher) return;
    const draft: Record<number, string> = {};
    for (const c of myClasses) draft[c.id] = c.subject || '';
    setSubjectDraft(draft);
  }, [user?.id, isTeacher, JSON.stringify(myClasses.map((c: any) => `${c.id}:${c.subject}`))]);

  useEffect(() => {
    if (!isTeacher) return;
    authAPI.getTeachableClasses().then((res) => setTeachable(res.data.classes || [])).catch(() => {});
  }, [isTeacher, user?.id]);

  /** 保存任教科目：即时生效，不需要审批 —— 科目只是自我描述，不授予权限 */
  const handleSaveSubjects = async () => {
    setSubjectSaving(true);
    try {
      const updates = myClasses.map((c: any) => ({
        class_id: c.id,
        subject: (subjectDraft[c.id] || '').trim() || null,
      }));
      await authAPI.updateMyTeachingSubjects(updates);
      message.success('任教科目已更新，之后布置作业会自动带出');
      await checkAuth();
    } catch (error: any) {
      message.error(error.response?.data?.error || '保存失败');
    } finally {
      setSubjectSaving(false);
    }
  };

  /** 申请加入班级任教：任教班级决定权限边界，必须由班主任/管理员审批 */
  const handleJoinClass = async (values: any) => {
    setJoinLoading(true);
    try {
      const res = await authAPI.requestJoinClass({
        class_id: values.class_id,
        subject: values.subject,
        teacher_type: values.teacher_type || 'teacher',
      });
      message.success(res.data.message || '申请已提交');
      joinForm.resetFields();
      authAPI.getTeachableClasses().then((r) => setTeachable(r.data.classes || [])).catch(() => {});
    } catch (error: any) {
      message.error(error.response?.data?.error || '提交失败');
    } finally {
      setJoinLoading(false);
    }
  };

  const handleUpdateProfile = async (values: any) => {
    setLoading(true);
    try {
      await authAPI.updateMe(values);
      message.success('个人信息更新成功');
    } catch (error: any) {
      message.error(error.response?.data?.error || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (values: any) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }
    setPasswordLoading(true);
    try {
      await authAPI.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword
      });
      message.success('密码修改成功');
    } catch (error: any) {
      message.error(error.response?.data?.error || '密码修改失败');
    } finally {
      setPasswordLoading(false);
    }
  };

  const tabItems = [
    {
      key: 'info',
      label: <span><UserOutlined /> 个人信息</span>,
      children: (
        <div>
          <Card style={{ marginBottom: 16, textAlign: 'center' }}>
            <Avatar size={72} icon={<UserOutlined />} src={user?.avatar} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 18, fontWeight: 600 }}>{user?.real_name || user?.username}</div>
            <div style={{ color: '#999', fontSize: 13, marginTop: 4 }}>
              {user?.role === 'student' ? '学生' : user?.role === 'teacher' ? '教师' : '管理员'}
              {user?.real_name ? ` · 账号：${user.username}` : ''}
            </div>
          </Card>
          <Card>
            <Form
              layout="vertical"
              initialValues={{ email: user?.email }}
              onFinish={handleUpdateProfile}
            >
              <Form.Item label="用户名">
                <Input
                  prefix={<UserOutlined />}
                  value={user?.username}
                  disabled
                />
              </Form.Item>
              <Form.Item label="角色">
                <Input
                  value={user?.role === 'student' ? '学生' : user?.role === 'teacher' ? '教师' : '管理员'}
                  disabled
                />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
              >
                <Input prefix={<MailOutlined />} placeholder="请输入邮箱" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  更新信息
                </Button>
              </Form.Item>
            </Form>
          </Card>

          {/* ===== 任教信息（仅教师/管理员） =====
              任教科目可自助修改且即时生效；任教班级影响权限边界，需班主任审批。 */}
          {isTeacher && (
            <>
              <Card
                title="任教班级与科目"
                style={{ marginTop: 16 }}
                extra={
                  <Button type="primary" size="small" loading={subjectSaving} onClick={handleSaveSubjects}>
                    保存科目
                  </Button>
                }
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="任教科目可以自己改，保存后立即生效"
                  description="它决定了布置作业和课堂做题时默认带出的科目，不需要任何人审批。"
                />
                {myClasses.length === 0 ? (
                  <Empty description="你还没有任教任何班级，可在下方申请加入" />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={myClasses}
                    columns={[
                      { title: '班级', dataIndex: 'name', key: 'name' },
                      {
                        title: '身份',
                        dataIndex: 'class_role',
                        key: 'class_role',
                        render: (r: string) => (
                          <Tag color={r === 'head_teacher' ? 'gold' : 'default'}>
                            {r === 'head_teacher' ? '班主任' : '任课教师'}
                          </Tag>
                        ),
                      },
                      {
                        title: '任教科目',
                        key: 'subject',
                        render: (_: any, r: any) => (
                          <Select
                            value={subjectDraft[r.id] || undefined}
                            placeholder="选择科目"
                            allowClear
                            style={{ width: 160 }}
                            onChange={(v) => setSubjectDraft((d) => ({ ...d, [r.id]: v || '' }))}
                            options={SUBJECT_OPTIONS.map((s) => ({ value: s, label: s }))}
                          />
                        ),
                      },
                    ]}
                  />
                )}
              </Card>

              <Card title="申请加入班级任教" style={{ marginTop: 16 }}>
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="任教班级需要审批"
                  description="加入班级意味着可以看到学生名单、进入班级群、收到该班的申请通知，因此必须由该班班主任（或管理员）同意。"
                />
                {teachable.filter((c) => !c.joined).length === 0 ? (
                  <div style={{ color: '#999', fontSize: 13 }}>暂无可申请的班级。</div>
                ) : (
                  <Form form={joinForm} layout="inline" onFinish={handleJoinClass} style={{ rowGap: 12 }}>
                    <Form.Item
                      name="class_id"
                      label="班级"
                      rules={[{ required: true, message: '请选择班级' }]}
                    >
                      <Select
                        placeholder="选择要加入的班级"
                        style={{ width: 220 }}
                        options={teachable
                          .filter((c) => !c.joined)
                          .map((c) => ({ value: c.id, label: `${c.name}${c.grade ? ` · ${c.grade}` : ''}` }))}
                      />
                    </Form.Item>
                    <Form.Item name="subject" label="任教科目">
                      <Select
                        placeholder="选择科目"
                        allowClear
                        style={{ width: 140 }}
                        options={SUBJECT_OPTIONS.map((s) => ({ value: s, label: s }))}
                      />
                    </Form.Item>
                    <Form.Item name="teacher_type" label="身份" initialValue="teacher">
                      <Select
                        style={{ width: 140 }}
                        options={[
                          { value: 'teacher', label: '任课教师' },
                          { value: 'head_teacher', label: '班主任' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={joinLoading}>
                        提交申请
                      </Button>
                    </Form.Item>
                  </Form>
                )}
              </Card>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'password',
      label: <span><LockOutlined /> 修改密码</span>,
      children: (
        <Card>
          <Form
            layout="vertical"
            onFinish={handleChangePassword}
            style={{ maxWidth: 460 }}
          >
            <Form.Item
              name="currentPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[{ required: true, message: '请输入新密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入新密码" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              rules={[{ required: true, message: '请确认新密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请确认新密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={passwordLoading}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    ...(isStudent ? [{
      key: 'assets',
      label: <span><WalletOutlined /> 资产明细</span>,
      children: <TransactionPanel />,
    }] : []),
  ];

  return (
    <div>
      {/* 页签放在页面顶部通栏，形态与「学习中心」「教学管理」一致；
          之前整页被限制在 600px 宽，标签又挤在卡片里，看着很小 */}
      <Tabs
        size="large"
        tabBarGutter={isMobile ? 16 : 32}
        activeKey={searchParams.get('sub') || 'info'}
        onChange={(key) => {
          setSearchParams(prev => {
            if (key === 'info') prev.delete('sub');
            else prev.set('sub', key);
            return prev;
          }, { replace: true });
        }}
        items={tabItems}
      />
    </div>
  );
};

export default Profile;
