import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Header, Content, Footer } = Layout;

interface StaticPageProps {
  title: string;
  children: React.ReactNode;
}

const StaticPageLayout: React.FC<StaticPageProps> = ({ title, children }) => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 100,
        padding: '0 24px', height: 56, position: 'sticky', top: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ color: '#fff' }} />
          <span style={{ fontSize: 16, fontWeight: 'bold', color: '#fff' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isAuthenticated ? (
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>{user?.username}</span>
          ) : (
            <Button type="link" onClick={() => navigate('/login')} style={{ color: '#fff', padding: 0 }}>登录</Button>
          )}
        </div>
      </Header>

      <Content style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', width: '100%' }}>
        <div style={{ background: '#fff', padding: '32px 40px', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {children}
        </div>
      </Content>

      <Footer style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        color: 'rgba(255,255,255,0.65)', textAlign: 'center', padding: '16px 24px',
      }}>
        <span style={{ fontSize: 12 }}>© 2026 班级宠物养成系统</span>
      </Footer>
    </Layout>
  );
};

export default StaticPageLayout;
