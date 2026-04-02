import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, Card, message, Typography, Select } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { authAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { Title } = Typography;
const { Option } = Select;

const Register: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState('student');

  useEffect(() => {
    loadClasses();
  }, []);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级列表失败');
    }
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const { confirmPassword, role, ...registerData } = values;
      const response = await authAPI.register({
        ...registerData,
        requested_class_ids: values.requested_class_ids
      });
      if (response.data.pending) {
        message.success(response.data.message);
        navigate('/login');
      } else {
        login(response.data.token, response.data.user);
        message.success('注册成功！');
        navigate('/');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Card style={{ width: 450, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <Title level={2} style={{ color: '#667eea', marginBottom: 8 }}>
            🎉 注册新账号
          </Title>
          <p style={{ color: '#999' }}>加入班级宠物养成系统</p>
        </div>

        <Form
          name="register"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[
              { required: true, message: '请输入用户名!' },
              { min: 3, message: '用户名至少 3 个字符!' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
            />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { type: 'email', message: '请输入有效的邮箱地址!' }
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="邮箱（可选）"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码!' },
              { min: 6, message: '密码至少 6 个字符!' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致!'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="确认密码"
            />
          </Form.Item>

          <Form.Item
            name="role"
            initialValue="student"
          >
            <Select placeholder="选择角色" onChange={(value) => setSelectedRole(value)}>
              <Option value="student">学生</Option>
              <Option value="teacher">教师</Option>
            </Select>
          </Form.Item>

          {selectedRole === 'student' && (
            <Form.Item
              name="requested_class_id"
              label="选择要加入的班级"
              rules={[{ required: true, message: '请选择要加入的班级' }]}
            >
              <Select placeholder="选择班级">
                {classes.map(c => (
                  <Option key={c.id} value={c.id}>{c.name} {c.grade ? `(${c.grade})` : ''}</Option>
                ))}
              </Select>
            </Form.Item>
          )}

          {selectedRole === 'teacher' && (
            <Form.Item
              name="requested_class_ids"
              label="选择要申请的班级（可多选）"
              rules={[{ required: true, message: '请至少选择一个班级' }]}
            >
              <Select mode="multiple" placeholder="选择要申请的班级" maxTagCount={2}>
                {classes.map(c => (
                  <Option key={c.id} value={c.id}>{c.name} {c.grade ? `(${c.grade})` : ''}</Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              style={{ marginTop: 8 }}
            >
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Link to="/login">已有账号？立即登录</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default Register;
