import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Tabs, Avatar } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { authAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const Profile: React.FC = () => {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

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
      label: '个人信息',
      children: (
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
      ),
    },
    {
      key: 'password',
      label: '修改密码',
      children: (
        <Card>
          <Form
            layout="vertical"
            onFinish={handleChangePassword}
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
  ];

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Card style={{ marginBottom: 24, textAlign: 'center' }}>
        <Avatar size={80} icon={<UserOutlined />} src={user?.avatar} style={{ marginBottom: 16 }} />
        <h2 style={{ margin: 0 }}>{user?.username}</h2>
        <p style={{ color: '#999', margin: '8px 0 0 0' }}>
          {user?.role === 'student' ? '学生' : user?.role === 'teacher' ? '教师' : '管理员'}
        </p>
      </Card>
      <Tabs items={tabItems} defaultActiveKey="info" />
    </div>
  );
};

export default Profile;
