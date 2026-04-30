import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Spin, Alert, Button, Space } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Login from './pages/Login';
import Register from './pages/Register';
import LandingPage from './pages/LandingPage';
import ClassHome from './pages/ClassHome';
import Workspace from './pages/Workspace';
import AboutPage from './pages/AboutPage';
import HelpPage from './pages/HelpPage';
import PrivacyPage from './pages/PrivacyPage';
import ContactPage from './pages/ContactPage';
import { useAuthStore } from './store/authStore';

// 路由守卫组件：未登录跳 /login 并带上原地址
export const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  return isAuthenticated
    ? <>{children}</>
    : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
};

// 根路径：始终展示首页内容
const RootRedirect: React.FC = () => {
  const { user } = useAuthStore();

  const pendingStudent = user && user.role === 'student'
    && ((user as any).status === 'pending_approval' || !user.class_slug);

  return (
    <>
      {pendingStudent && (
        <div style={{ padding: 12 }}>
          <Alert
            type="warning"
            showIcon
            message="您的入班申请尚未处理"
            description="请联系班主任处理您的申请，或留在公开首页浏览各班级。接入班级后即可体验完整功能。"
            action={
              <Space>
                <Button size="small" onClick={() => window.location.href = '/login'}>查询进度</Button>
              </Space>
            }
          />
        </div>
      )}
      <LandingPage />
    </>
  );
};

const App: React.FC = () => {
  const { checkAuth } = useAuthStore();
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    const initAuth = async () => {
      await checkAuth();
      setLoading(false);
    };
    initAuth();
  }, [checkAuth]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}>
        <Spin size="large">
          <span style={{ paddingLeft: 16 }}>加载中...</span>
        </Spin>
      </div>
    );
  }

  return (
    <ConfigProvider locale={zhCN}>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/workspace" element={<PrivateRoute><Workspace /></PrivateRoute>} />
          <Route path="/c/:slug" element={<ClassHome />} />
          <Route path="/c/:slug/app" element={<PrivateRoute><Workspace /></PrivateRoute>} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/" element={<RootRedirect />} />
        </Routes>
      </Router>
    </ConfigProvider>
  );
};

export default App;
