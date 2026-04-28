import React, { useState, useEffect } from 'react';
import { Card, Button, Input, message, Space, Tag, Table, Modal, Form, Select, DatePicker, QRCode, Typography, Drawer, Switch } from 'antd';
import { CopyOutlined, PlusOutlined, QrcodeOutlined, LinkOutlined, SettingOutlined } from '@ant-design/icons';
import { classAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';

const { Option } = Select;
const { Text, Paragraph } = Typography;

const ClassInvitationManager: React.FC = () => {
  const { user } = useAuthStore();
  const [myClass, setMyClass] = useState<any>(null);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [qrModal, setQrModal] = useState<{ open: boolean; url: string; code: string }>({ open: false, url: '', code: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    if (user?.role === 'teacher' || user?.role === 'admin') {
      loadMyClass();
    }
  }, [user]);

  const loadMyClass = async () => {
    try {
      const res = await classAPI.getMyClass();
      if (res.data.class) {
        setMyClass(res.data.class);
        loadInvitations(res.data.class.id);
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '加载班级信息失败');
    }
  };

  const loadInvitations = async (classId: number) => {
    setLoading(true);
    try {
      const res = await classAPI.getInvitations(classId);
      setInvitations(res.data.invitations || []);
    } catch (error: any) {
      message.error(error.response?.data?.error || '加载邀请码列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClass = async () => {
    try {
      const values = await createForm.validateFields();
      const res = await classAPI.createClass({
        name: values.name,
        grade: values.grade
      });
      
      message.success('班级创建成功！');
      setCreateModalVisible(false);
      createForm.resetFields();
      
      // 显示初始推荐码和链接
      message.success(
        `推荐码：${res.data.invitation_code}\n推荐链接：${res.data.invitation_link}`,
        8
      );
      
      loadMyClass();
    } catch (error: any) {
      message.error(error.response?.data?.error || '创建班级失败');
    }
  };

  const handleCreateInvitation = async () => {
    if (!myClass) return;

    try {
      const values = await createForm.validateFields();
      const res = await classAPI.createInvitation(myClass.id, {
        role_filter: values.role_filter,
        max_uses: values.max_uses || null,
        expires_at: values.expires_at ? values.expires_at.format('YYYY-MM-DD HH:mm:ss') : null
      });

      const inviteLink = `${window.location.origin}/register?invite=${res.data.invitation_code}`;
      message.success(
        `推荐码：${res.data.invitation_code}\n推荐链接：${inviteLink}`,
        8
      );
      loadInvitations(myClass.id);
      setCreateModalVisible(false);
      createForm.resetFields();
    } catch (error: any) {
      message.error(error.response?.data?.error || '生成推荐码失败');
    }
  };

  const handleToggleInvitation = async (invitationId: number) => {
    try {
      const res = await classAPI.toggleInvitation(invitationId);
      message.success(res.data.message);
      if (myClass) {
        loadInvitations(myClass.id);
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  };

  const getRecommendLink = (code: string) => {
    return `${window.location.origin}/register?invite=${code}`;
  };

  const getClassHomeLink = () => {
    if (myClass?.slug) return `${window.location.origin}/c/${myClass.slug}`;
    return '';
  };

  const openQr = (code: string) => {
    setQrModal({ open: true, url: getRecommendLink(code), code });
  };

  const openSettings = () => {
    if (!myClass) return;
    settingsForm.setFieldsValue({
      description: myClass.description || '',
      cover_image: myClass.cover_image || '',
      is_public: !!myClass.is_public,
      slug: myClass.slug || '',
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!myClass) return;
    try {
      const values = await settingsForm.validateFields();
      setSettingsSaving(true);
      const { description, cover_image, is_public, slug } = values;
      await classAPI.updateClassSettings(myClass.id, { description, cover_image, is_public });
      if (slug && slug !== myClass.slug) {
        await classAPI.updateClassSlug(myClass.id, slug);
      }
      message.success('给班级设置已更新');
      setSettingsOpen(false);
      await loadMyClass();
    } catch (error: any) {
      if (error?.errorFields) return; // antd form validation
      message.error(error?.response?.data?.error || '保存失败');
    } finally {
      setSettingsSaving(false);
    }
  };

  const getStatusTag = (invitation: any) => {
    if (!invitation.is_active) {
      return <Tag color="red">已禁用</Tag>;
    }
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return <Tag color="orange">已过期</Tag>;
    }
    if (invitation.max_uses && invitation.used_count >= invitation.max_uses) {
      return <Tag color="orange">已达上限</Tag>;
    }
    return <Tag color="green">有效</Tag>;
  };

  const columns = [
    {
      title: '推荐码',
      dataIndex: 'invitation_code',
      key: 'invitation_code',
      render: (code: string) => (
        <Space>
          <strong style={{ fontSize: '16px', letterSpacing: '2px', color: '#1890ff' }}>{code}</strong>
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={() => copyToClipboard(code)}
            size="small"
          />
        </Space>
      )
    },
    {
      title: '邀请对象',
      dataIndex: 'role_filter',
      key: 'role_filter',
      render: (role: string) => {
        const map: any = { student: '学生', teacher: '教师', any: '所有人' };
        return <Tag>{map[role] || role}</Tag>;
      }
    },
    {
      title: '使用情况',
      key: 'usage',
      render: (_: any, record: any) => (
        record.max_uses ? `${record.used_count} / ${record.max_uses}` : `${record.used_count} / 无限制`
      )
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => getStatusTag(record)
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (time: string) => time ? new Date(time).toLocaleString() : '永不过期'
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space direction="vertical" size="small">
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => copyToClipboard(getRecommendLink(record.invitation_code))}
            size="small"
          >
            复制推荐链接
          </Button>
          <Button
            type="link"
            icon={<QrcodeOutlined />}
            onClick={() => openQr(record.invitation_code)}
            size="small"
          >
            二维码
          </Button>
          <Button
            type="link"
            onClick={() => handleToggleInvitation(record.id)}
            size="small"
          >
            {record.is_active ? '禁用' : '启用'}
          </Button>
        </Space>
      )
    }
  ];

  if (user?.role !== 'teacher' && user?.role !== 'admin') {
    return null;
  }

  if (!myClass) {
    return (
      <Card title="班级管理">
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p>您还没有创建班级</p>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建班级
          </Button>
        </div>

        <Modal
          title="创建班级"
          open={createModalVisible}
          onCancel={() => setCreateModalVisible(false)}
          onOk={handleCreateClass}
        >
          <Form form={createForm} layout="vertical">
            <Form.Item
              name="name"
              label="班级名称"
              rules={[{ required: true, message: '请输入班级名称' }]}
            >
              <Input placeholder="例如：三年级一班" />
            </Form.Item>
            <Form.Item
              name="grade"
              label="年级"
            >
              <Input placeholder="例如：三年级" />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <span>班级管理 - {myClass.name}</span>
          {myClass.grade && <Tag color="blue">{myClass.grade}</Tag>}
        </Space>
      }
      extra={
        <Space>
          {myClass?.slug && (
            <>
              <Button
                icon={<LinkOutlined />}
                onClick={() => copyToClipboard(getClassHomeLink())}
              >
                复制班级主页
              </Button>
              <Button
                icon={<QrcodeOutlined />}
                onClick={() => setQrModal({ open: true, url: getClassHomeLink(), code: myClass.slug })}
              >
                班级主页二维码
              </Button>
            </>
          )}
          <Button icon={<SettingOutlined />} onClick={openSettings}>
            班级设置
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              createForm.resetFields();
              setCreateModalVisible(true);
            }}
          >
            生成新推荐码
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={invitations}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="生成推荐码"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onOk={handleCreateInvitation}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="role_filter"
            label="邀请对象"
            initialValue="any"
          >
            <Select>
              <Option value="any">所有人</Option>
              <Option value="student">仅限学生</Option>
              <Option value="teacher">仅限教师</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="max_uses"
            label="最大使用次数"
            tooltip="留空表示无限制"
          >
            <Input type="number" min={1} placeholder="留空表示无限制" />
          </Form.Item>
          <Form.Item
            name="expires_at"
            label="过期时间"
            tooltip="留空表示永不过期"
          >
            <DatePicker
              showTime
              style={{ width: '100%' }}
              disabledDate={(current) => current && current < dayjs().startOf('day')}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="扫一扫加入班级"
        open={qrModal.open}
        onCancel={() => setQrModal({ open: false, url: '', code: '' })}
        footer={null}
        width={360}
      >
        <div style={{ textAlign: 'center' }}>
          {qrModal.url && (
            <QRCode value={qrModal.url} size={240} />
          )}
          <Paragraph copyable={{ text: qrModal.url }} style={{ marginTop: 12, wordBreak: 'break-all' }}>
            <Text type="secondary">{qrModal.url}</Text>
          </Paragraph>
          {qrModal.code && (
            <Paragraph copyable={{ text: qrModal.code }}>
              <Text strong>编码/Slug：</Text>{qrModal.code}
            </Paragraph>
          )}
        </div>
      </Modal>

      <Drawer
        title="班级设置"
        width={420}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        extra={<Button type="primary" loading={settingsSaving} onClick={saveSettings}>保存</Button>}
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item name="description" label="班级简介">
            <Input.TextArea rows={3} maxLength={300} showCount placeholder="班级介绍、口号等" />
          </Form.Item>
          <Form.Item name="cover_image" label="封面图片 URL">
            <Input placeholder="支持 https 图片链接，或后期上传后的地址" />
          </Form.Item>
          <Form.Item name="is_public" label="对外公开班级主页" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="slug"
            label="班级标识 (slug)"
            tooltip="3-32 位字母/数字/连字符，用于公开顶域如 /c/my-class"
            rules={[
              { pattern: /^[a-z0-9][a-z0-9-]{2,31}$/i, message: '3-32 位字母/数字/连字符，首字符为字母或数字' },
            ]}
          >
            <Input placeholder="如 my-class-2024" />
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
};

export default ClassInvitationManager;
