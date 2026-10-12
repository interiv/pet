import React, { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Button, Spin, Space } from 'antd';
import { ArrowLeftOutlined, HomeOutlined, LoginOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Header, Content, Footer } = Layout;

/**
 * 把强调色压暗一档，用来生成渐变的收尾色。
 *
 * accent 是一个十六进制色值（#667eea），顶栏要的是
 * 「从强调色到更深一档」的渐变；没有这个函数就只能写死渐变，
 * 于是 accent 这个 props 名义上管顶栏、实际只作用于页脚那一个链接，
 * 四页传什么都不生效。
 */
function darken(hex: string, ratio = 0.25): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const ch = [(num >> 16) & 255, (num >> 8) & 255, num & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(c * (1 - ratio)))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 首页统计卡片点进去的几个「名录页」（学校 / 班级 / 教师 / 学生）共用外壳。
 *
 * 抽出来是因为这四页要的东西完全一致：同一个顶栏配色、同一个返回首页入口、
 * 同一个加载态、同一个页脚。各页只负责自己的列表长什么样。
 */
interface DirectoryLayoutProps {
  title: string;
  subtitle?: string;
  /** 顶栏强调色，默认沿用首页的紫渐变 */
  accent?: string;
  loading?: boolean;
  children: ReactNode;
}

const DirectoryLayout: React.FC<DirectoryLayoutProps> = ({
  title, subtitle, accent = '#667eea', loading = false, children,
}) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        // 顶栏真的按 accent 走渐变（accent → 压暗一档），
        // 否则这个 props 只作用于页脚那个「返回首页」链接，注释与实现对不上
        background: `linear-gradient(135deg, ${accent} 0%, ${darken(accent)} 100%)`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 100,
        padding: '0 12px', height: 56, position: 'sticky', top: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ color: '#fff' }} />
          <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')} style={{ color: '#fff' }} />
          <span style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap' }}>{title}</span>
          {subtitle && (
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </span>
          )}
        </div>
        <Space size={8}>
          {isAuthenticated ? (
            <>
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{user?.real_name || user?.username}</span>
              <Button type="text" icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/'); }} style={{ color: '#fff' }} />
            </>
          ) : (
            <Button type="primary" ghost size="small" icon={<LoginOutlined />} onClick={() => navigate('/login')}>登录</Button>
          )}
        </Space>
      </Header>

      <Content style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 12px 40px', width: '100%' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spin size="large"><span style={{ paddingLeft: 16, color: '#999' }}>加载中...</span></Spin>
          </div>
        ) : children}
      </Content>

      <Footer style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        color: 'rgba(255,255,255,0.65)', textAlign: 'center', padding: '16px 24px',
      }}>
        <div style={{ fontSize: 12 }}>© 2026 班级宠物养成系统 · {title}</div>
        <div style={{ marginTop: 6 }}>
          <Button type="link" size="small" onClick={() => navigate('/')} style={{ color: accent, padding: 0, fontSize: 12 }}>
            返回首页
          </Button>
        </div>
      </Footer>
    </Layout>
  );
};

export default DirectoryLayout;
