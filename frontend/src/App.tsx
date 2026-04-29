import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Spin, Alert, Button, Space } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import LandingPage from './pages/LandingPage';
import ClassHome from './pages/ClassHome';
import ClassesPicker from './pages/ClassesPicker';
import Workspace from './pages/Workspace';
import { useAuthStore } from './store/authStore';

// 路由守卫组件：未登录跳 /login 并带上原地址
export const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  return isAuthenticated
    ? <>{children}</>
    : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
};

// 根路径分发：未登录留在集体首页（Home），登录后根据角色跳转
const RootRedirect: React.FC = () => {
  const { isAuthenticated, user, currentClass } = useAuthStore();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    // 班主任/教师有多班时进入选择页
    if ((user.role === 'teacher' || user.role === 'admin') && (user.teacher_classes?.length || 0) > 1) {
      navigate('/classes-picker', { replace: true });
      return;
    }
    // 单班教师：直接进入自己的班级
    if ((user.role === 'teacher' || user.role === 'admin') && user.teacher_classes?.length === 1) {
      navigate(`/c/${user.teacher_classes[0].slug}/app`, { replace: true });
      return;
    }
    // 学生：进入所属班级
    if (user.class_slug) {
      navigate(`/c/${user.class_slug}/app`, { replace: true });
      return;
    }
    // 保留上次所选班级
    if (currentClass?.slug) {
      navigate(`/c/${currentClass.slug}/app`, { replace: true });
    }
  }, [isAuthenticated, user, currentClass, navigate]);

  // 未登录：展示落地页
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  // 学生待审批 或 无所属班级：在集体首页顶部显示提示条
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
      <Home />
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
          <Route path="/classes-picker" element={<PrivateRoute><ClassesPicker /></PrivateRoute>} />
          <Route path="/c/:slug" element={<ClassHome />} />
          <Route path="/c/:slug/app" element={<PrivateRoute><Workspace /></PrivateRoute>} />
          <Route path="/" element={<RootRedirect />} />
        </Routes>
      </Router>
    </ConfigProvider>
  );
};

export default App;
