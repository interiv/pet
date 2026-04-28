import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Empty, Tag, Button, Spin, Space } from 'antd';
import { TeamOutlined, PlusOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Title, Paragraph } = Typography;

/**
 * ClassesPicker: 教师（或管理员）多班级选择页。
 * 数据来源：authStore.user.teacher_classes
 */
const ClassesPicker: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, setCurrentClass } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    // 自动分发：无任何班级的教师，跳首页
    if (!user.teacher_classes || user.teacher_classes.length === 0) {
      navigate('/', { replace: true });
      return;
    }
    // 单班直接进入
    if (user.teacher_classes.length === 1) {
      const c = user.teacher_classes[0];
      setCurrentClass({ id: c.id, slug: c.slug, name: c.name });
      navigate(`/c/${c.slug}/app`, { replace: true });
      return;
    }
    setLoading(false);
  }, [user, navigate, setCurrentClass]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const classes = user?.teacher_classes || [];

  return (
    <div style={{ minHeight: '100vh', padding: 24, background: '#f5f5f5' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              <TeamOutlined /> 选择要进入的班级
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              你是 {classes.length} 个班级的任课/班主任老师，选择一个进入工作台
            </Paragraph>
          </div>
          <Space>
            <Button icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/login'); }}>
              退出登录
            </Button>
          </Space>
        </div>

        {classes.length === 0 ? (
          <Empty description="尚未加入任何班级">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/')}>返回首页</Button>
          </Empty>
        ) : (
          <Row gutter={[16, 16]}>
            {classes.map((c) => (
              <Col xs={24} sm={12} md={8} key={c.id}>
                <Card
                  hoverable
                  onClick={() => {
                    setCurrentClass({ id: c.id, slug: c.slug, name: c.name });
                    navigate(`/c/${c.slug}/app`);
                  }}
                  title={c.name}
                  extra={c.class_role === 'head' ? <Tag color="gold">班主任</Tag> : <Tag color="blue">任课</Tag>}
                >
                  <Paragraph style={{ marginBottom: 4 }}>年级：{c.grade || '-'}</Paragraph>
                  <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                    slug：{c.slug}
                  </Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>
    </div>
  );
};

export default ClassesPicker;
