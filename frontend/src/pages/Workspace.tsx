import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, Result, Button } from 'antd';
import Home from './Home';
import { useAuthStore } from '../store/authStore';
import { classAPI } from '../utils/api';

const Workspace: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, currentClass, setCurrentClass } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      if (user?.role === 'teacher' || user?.role === 'admin') {
        setCurrentClass(null);
        setLoading(false);
        return;
      }
      if (user?.role === 'student' && user?.class_slug) {
        navigate(`/c/${user.class_slug}/app`, { replace: true });
        return;
      }
      setError('缺少班级标识');
      setLoading(false);
      return;
    }

    if (currentClass && currentClass.slug === slug) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await classAPI.getBySlug(slug);
        const cls = res.data.class;
        if (!cls) {
          setError('班级不存在');
          return;
        }
        setCurrentClass({
          id: cls.id,
          slug: cls.slug,
          name: cls.name,
          theme_color: cls.school_theme || undefined,
        });
      } catch (e: any) {
        setError(e?.response?.data?.error || '班级加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, currentClass, setCurrentClass, user, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large">
          <span style={{ paddingLeft: 16 }}>正在进入班级...</span>
        </Spin>
      </div>
    );
  }

  if (error) {
    return (
      <Result
        status="404"
        title="无法进入班级"
        subTitle={error}
        extra={
          <>
            <Button type="primary" onClick={() => navigate('/')}>返回首页</Button>
          </>
        }
      />
    );
  }

  return <Home />;
};

export default Workspace;
