import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tabs, Form, Input, message, Tag, Space, TabsProps } from 'antd';
import { UserOutlined, SettingOutlined } from '@ant-design/icons';
import { adminAPI } from '../utils/api';

const Admin: React.FC = () => {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsForm] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    loadPendingTeachers();
    loadSettings();
  }, []);

  const loadPendingTeachers = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getPendingTeachers();
      setTeachers(res.data.teachers || []);
    } catch (error) {
      message.error('加载待审批教师列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number, action: 'approve' | 'reject') => {
    try {
      await adminAPI.approveTeacher(id, action);
      message.success(action === 'approve' ? '已通过审批' : '已拒绝注册');
      loadPendingTeachers();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getAISettings();
      settingsForm.setFieldsValue(res.data.settings);
    } catch (error) {
      message.error('加载设置失败');
    }
  };

  const handleSaveSettings = async (values: any) => {
    setSettingsLoading(true);
    try {
      await adminAPI.saveAISettings(values);
      message.success('大模型设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setSettingsLoading(false);
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at' },
    { title: '状态', dataIndex: 'status', key: 'status', render: () => <Tag color="warning">待审批</Tag> },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="middle">
          <Button type="primary" size="small" onClick={() => handleApprove(record.id, 'approve')}>通过</Button>
          <Button danger size="small" onClick={() => handleApprove(record.id, 'reject')}>拒绝</Button>
        </Space>
      ),
    },
  ];

  const tabItems: TabsProps['items'] = [
    {
      key: 'teachers',
      label: <span><UserOutlined /> 教师审批</span>,
      children: (
        <Table 
          columns={columns} 
          dataSource={teachers} 
          rowKey="id" 
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      )
    },
    {
      key: 'ai-settings',
      label: <span><SettingOutlined /> 大模型设置</span>,
      children: (
        <Card style={{ maxWidth: 600 }}>
          <Form
            form={settingsForm}
            layout="vertical"
            onFinish={handleSaveSettings}
          >
            <Form.Item
              name="ai_model"
              label="大模型名称 (例如 gpt-3.5-turbo)"
              rules={[{ required: true, message: '请输入模型名称' }]}
            >
              <Input placeholder="输入模型名称" />
            </Form.Item>
            <Form.Item
              name="ai_base_url"
              label="API Base URL"
              rules={[{ required: true, message: '请输入API基础地址' }]}
            >
              <Input placeholder="例如 https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item
              name="ai_api_key"
              label="API Key"
              rules={[{ required: true, message: '请输入API Key' }]}
            >
              <Input.Password placeholder="输入 API 密钥" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={settingsLoading}>
                保存设置
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )
    }
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>管理控制台</h2>
      <Tabs defaultActiveKey="teachers" items={tabItems} />
    </div>
  );
};

export default Admin;