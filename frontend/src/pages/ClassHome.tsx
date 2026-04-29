import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Card, Row, Col, Typography, Tag, Button, List, Avatar, Spin, Result, Space, Progress, Empty, Divider, message } from 'antd';
import { TeamOutlined, TrophyOutlined, NotificationOutlined, FireOutlined, LoginOutlined, UserAddOutlined, RightOutlined } from '@ant-design/icons';
import { classAPI, leaderboardAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

const { Header, Content, Footer } = Layout;
const { Title, Paragraph, Text } = Typography;

interface ClassPublic {
  id: number;
  name: string;
  slug: string;
  grade?: string;
  description?: string;
  cover_image?: string;
  is_public?: number;
  school_id?: number;
  school_name?: string;
  school_theme?: string;
  teachers?: Array<{ id: number; username: string; role: string; class_role?: string }>;
  active_boss?: any;
  public_invitation_code?: string | null;
  student_count?: number;
}

const ClassHome: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user, setCurrentClass } = useAuthStore();
  const isMobile = useMobile();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cls, setCls] = useState<ClassPublic | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [topPets, setTopPets] = useState<any[]>([]);

  useEffect(() => {
    if (!slug) return;
    loadPublic();
  }, [slug]);

  const loadPublic = async () => {
    setLoading(true);
    try {
      const res = await classAPI.getBySlug(slug!);
      const data: ClassPublic = res.data.class;
      setCls(data);
      // 若已登录且是成员，尝试拉取完整聚合
      if (isAuthenticated && user) {
        try {
          const sum = await classAPI.getHomeSummary(data.id);
          setSummary(sum.data);
        } catch (_) {
          // 非成员 => 走公开排行榜兜底
          try {
            const lb = await leaderboardAPI.getLevelLeaderboard({ class_id: data.id, limit: 10 });
            setTopPets(lb.data.leaderboard || lb.data.pets || []);
          } catch (_) { /* ignore */ }
        }
      } else {
        try {
          const lb = await leaderboardAPI.getLevelLeaderboard({ class_id: data.id, limit: 10 });
          setTopPets(lb.data.leaderboard || lb.data.pets || []);
        } catch (_) { /* ignore */ }
      }
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
      else message.error(e?.response?.data?.error || '班级加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (notFound || !cls) {
    return (
      <Result
        status="404"
        title="班级不存在"
        subTitle="该班级链接可能已失效，或尚未设为公开"
        extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
      />
    );
  }

  const isMember = Boolean(summary);
  const teachers = (summary?.teachers || cls.teachers || []) as any[];
  const headTeacher = teachers.find((t: any) => t.class_role === 'head');
  const pets = (summary?.top_pets || topPets) as any[];
  const announcements = (summary?.announcements || []) as any[];
  const recentPosts = (summary?.recent_posts || []) as any[];
  const activeBoss = summary?.active_boss || cls.active_boss;

  const themeColor = cls.school_theme || '#1890ff';

  const enterWorkspace = () => {
    setCurrentClass({ id: cls.id, slug: cls.slug, name: cls.name, theme_color: cls.school_theme });
    navigate(`/c/${cls.slug}/app`);
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <Header style={{ background: themeColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0 12px' : '0 24px' }}>
        <div>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
            {cls.school_name ? `${cls.school_name} · ` : ''}{cls.name}
          </Text>
          {cls.grade && <Tag color="gold" style={{ marginLeft: 8 }}>{cls.grade}</Tag>}
        </div>
        <Space>
          {isAuthenticated ? (
            isMember ? (
              <Button type="primary" ghost onClick={enterWorkspace} icon={<RightOutlined />}>进入工作台</Button>
            ) : (
              <Button type="primary" ghost onClick={() => navigate('/')}>返回我的主页</Button>
            )
          ) : (
            <>
              <Button type="primary" ghost icon={<LoginOutlined />} onClick={() => navigate('/login')}>登录</Button>
              <Button type="default" icon={<UserAddOutlined />} onClick={() => navigate(`/register${cls.public_invitation_code ? `?invite=${cls.public_invitation_code}` : ''}`)}>
                加入班级
              </Button>
            </>
          )}
        </Space>
      </Header>

      <Content style={{ padding: isMobile ? 12 : 24 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* 封面/简介 */}
          <Card
            cover={cls.cover_image ? (
              <div style={{ height: 200, overflow: 'hidden' }}>
                <img alt="封面" src={cls.cover_image} style={{ width: '100%', objectFit: 'cover' }} />
              </div>
            ) : undefined}
            style={{ marginBottom: 16 }}
          >
            <Title level={4} style={{ marginTop: 0 }}>
              <TeamOutlined /> 班级简介
            </Title>
            <Paragraph>
              {cls.description || '班主任还没有填写班级简介。'}
            </Paragraph>
            <Space split={<Divider type="vertical" />} wrap>
              {headTeacher && <Text>班主任：<b>{headTeacher.username}</b></Text>}
              {typeof (summary?.student_count ?? cls.student_count) === 'number' && (
                <Text>学生人数：<b>{summary?.student_count ?? cls.student_count}</b></Text>
              )}
              {cls.school_name && <Text>学校：<b>{cls.school_name}</b></Text>}
            </Space>
          </Card>

          <Row gutter={[16, 16]}>
            {/* 左栏 */}
            <Col xs={24} md={16}>
              {/* BOSS */}
              {activeBoss && (
                <Card title={<><FireOutlined style={{ color: '#f5222d' }} /> 班级 BOSS 挑战</>} style={{ marginBottom: 16 }}>
                  <Paragraph style={{ marginBottom: 8 }}>
                    <b>{activeBoss.name || activeBoss.boss_name || 'BOSS'}</b>
                    {activeBoss.status && <Tag color="red" style={{ marginLeft: 8 }}>{activeBoss.status}</Tag>}
                  </Paragraph>
                  {typeof activeBoss.current_hp === 'number' && typeof activeBoss.max_hp === 'number' && (
                    <Progress
                      percent={Math.max(0, Math.min(100, Math.round((activeBoss.current_hp / activeBoss.max_hp) * 100)))}
                      strokeColor={{ '0%': '#ff4d4f', '100%': '#ff7a45' }}
                      format={() => `${activeBoss.current_hp} / ${activeBoss.max_hp}`}
                    />
                  )}
                </Card>
              )}

              {/* 公告 */}
              <Card title={<><NotificationOutlined /> 班级公告</>} style={{ marginBottom: 16 }}>
                {announcements.length === 0 ? (
                  <Empty description={isMember ? '暂无公告' : '登录后查看最新公告'} />
                ) : (
                  <List
                    dataSource={announcements}
                    renderItem={(item: any) => (
                      <List.Item>
                        <List.Item.Meta
                          title={item.title}
                          description={<Text type="secondary">{new Date(item.created_at).toLocaleString()}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>

              {/* 最近留言 */}
              <Card title="班级留言" style={{ marginBottom: 16 }}>
                {recentPosts.length === 0 ? (
                  <Empty description={isMember ? '暂无留言' : '登录后查看班级留言'} />
                ) : (
                  <List
                    dataSource={recentPosts}
                    renderItem={(item: any) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={<Avatar>{(item.author_name || 'U').slice(0, 1)}</Avatar>}
                          title={item.author_name || item.username}
                          description={<Paragraph ellipsis={{ rows: 2 }}>{item.content}</Paragraph>}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            {/* 右栏 */}
            <Col xs={24} md={8}>
              {/* 任课教师 */}
              <Card title={<><TeamOutlined /> 任课教师</>} style={{ marginBottom: 16 }}>
                {teachers.length === 0 ? (
                  <Empty description="暂无教师" />
                ) : (
                  <List
                    dataSource={teachers}
                    renderItem={(t: any) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={<Avatar>{(t.username || 'T').slice(0, 1)}</Avatar>}
                          title={<>{t.username} {t.class_role === 'head' && <Tag color="gold">班主任</Tag>}</>}
                          description={t.role === 'admin' ? '管理员' : '教师'}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>

              {/* 宠物排行榜 */}
              <Card title={<><TrophyOutlined /> 宠物排行榜 Top10</>}>
                {pets.length === 0 ? (
                  <Empty description="暂无数据" />
                ) : (
                  <List
                    dataSource={pets.slice(0, 10)}
                    renderItem={(p: any, idx: number) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={<Avatar style={{ background: idx < 3 ? '#faad14' : '#d9d9d9' }}>{idx + 1}</Avatar>}
                          title={p.pet_name || p.name || '宠物'}
                          description={<Space size="small">
                            <Text type="secondary">主人：{p.owner_name || p.username || '-'}</Text>
                            <Text type="secondary">Lv.{p.level ?? '-'}</Text>
                          </Space>}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </div>
      </Content>

      <Footer style={{ textAlign: 'center' }}>
        班级宠物养成系统 · {cls.school_name || '班级主页'}
      </Footer>
    </Layout>
  );
};

export default ClassHome;
