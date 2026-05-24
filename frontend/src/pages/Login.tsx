import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Form, Input, Button, Card, message, Typography, Modal, List, Tag, Empty } from 'antd';
import { UserOutlined, LockOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { authAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

const { Title, Text } = Typography;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);
  const [statusVisible, setStatusVisible] = useState(false);
  const [statusUsername, setStatusUsername] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusData, setStatusData] = useState<any>(null);
  const isMobile = useMobile();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const response = await authAPI.login(values);
      login(response.data.token, response.data.user);
      message.success('登录成功！');

      // 登录后回跳原址：优先 location.state.from，再其次根路径
      const fromPath = (location.state as any)?.from?.pathname || (location.state as any)?.from || '/';

      // 检查新手引导状态
      const newbieGuide = localStorage.getItem('newbie_guide');
      if (!newbieGuide && response.data.user.role === 'student') {
        // 检查是否有宠物
        try {
          const { petAPI } = await import('../utils/api');
          await petAPI.getMyPet();
          // 有宠物，标记引导完成
          localStorage.setItem('newbie_guide', 'completed');
        } catch (error) {
          // 没有宠物，需要引导
          navigate(fromPath, { replace: true });
          return;
        }
      }

      navigate(fromPath, { replace: true });
    } catch (error: any) {
      message.error(error.response?.data?.error || '登录失败');
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
      <Card style={{ width: isMobile ? '92vw' : 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <Title level={2} style={{ color: '#667eea', marginBottom: 8 }}>
            🐾 班级宠物养成系统
          </Title>
          <p style={{ color: '#999' }}>登录你的账号</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名!' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              block
              size="large"
              style={{ marginTop: 8 }}
            >
              登录
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Link to="/register">还没有账号？立即注册</Link>
          </div>
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Button type="link" icon={<QuestionCircleOutlined />} onClick={() => { setStatusData(null); setStatusUsername(''); setStatusVisible(true); }}>
              查询注册/入班审批进度
            </Button>
          </div>
        </Form>
      </Card>

      <Modal
        title="审批进度查询"
        open={statusVisible}
        onCancel={() => setStatusVisible(false)}
        footer={null}
        width={isMobile ? '95vw' : undefined}
      >
        <Form layout="inline" onFinish={async () => {
          if (!statusUsername) { message.warning('请输入用户名'); return; }
          setStatusLoading(true);
          try {
            const res = await authAPI.getApprovalStatus(statusUsername);
            setStatusData(res.data);
          } catch (e: any) {
            message.error(e?.response?.data?.error || '查询失败');
            setStatusData(null);
          } finally {
            setStatusLoading(false);
          }
        }}>
          <Form.Item style={{ flex: 1 }}>
            <Input placeholder="输入注册时的用户名" value={statusUsername} onChange={(e) => setStatusUsername(e.target.value)} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={statusLoading}>查询</Button>
          </Form.Item>
        </Form>

        {statusData && (
          <div style={{ marginTop: 16 }}>
            <p>
              <Text strong>账号状态：</Text>
              {statusData.status === 'active' && <Tag color="green">已激活</Tag>}
              {statusData.status === 'pending' && <Tag color="orange">待审批</Tag>}
              {statusData.status === 'rejected' && <Tag color="red">已拒绝</Tag>}
              {statusData.status === 'disabled' && <Tag color="default">已禁用</Tag>}
            </p>
            {(!statusData.applications || statusData.applications.length === 0) ? (
              <Empty description="暂无班级申请记录" />
            ) : (
              <List
                header={<Text strong>班级申请：</Text>}
                dataSource={statusData.applications}
                renderItem={(a: any) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<>{a.class_name || `班级#${a.class_id}`}</>}
                      description={<Text type="secondary">角色：{a.role === 'teacher' ? '教师' : '学生'} · 申请时间：{new Date(a.created_at).toLocaleString()}</Text>}
                    />
                    {a.status === 'approved' && <Tag color="green">已通过</Tag>}
                    {a.status === 'pending' && <Tag color="orange">待审批</Tag>}
                    {a.status === 'rejected' && <Tag color="red">已拒绝</Tag>}
                  </List.Item>
                )}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Login;
