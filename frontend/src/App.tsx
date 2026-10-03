import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Spin, Alert, Button, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useAuthStore } from './store/authStore';
import LandingPage from './pages/LandingPage';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ClassHome = lazy(() => import('./pages/ClassHome'));
const Workspace = lazy(() => import('./pages/Workspace'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const VersionWatcher = lazy(() => import('./components/VersionWatcher'));

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
  const { user, checkAuth } = useAuthStore();
  const [refreshing, setRefreshing] = React.useState(false);

  // 只有「自己注册待审批」或「确实还没有任何班级」才算待处理；
  // 管理员批量导入 / 生成账号的学生入班即生效（class_id 有值），不该再提示申请进度
  const pendingStudent = user && user.role === 'student'
    && ((user as any).status === 'pending_approval' || !(user as any).class_id);

  // 「查询进度」= 重新拉取当前账号状态，而不是把人送回登录页
  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      await checkAuth();
      message.info('已刷新账号状态，若审批已通过可直接进入班级工作台');
    } catch (e) {
      message.error('刷新失败，请稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

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
              <Button size="small" loading={refreshing} onClick={refreshStatus}>查询进度</Button>
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
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <Spin size="large"><span style={{ paddingLeft: 16 }}>加载中...</span></Spin>
          </div>
        }>
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
        </Suspense>
        {/* 服务端升级后引导用户刷新，避免继续用旧前端调新接口 */}
        <VersionWatcher />
      </Router>
    </ConfigProvider>
  );
};

export default App;
