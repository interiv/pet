import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Button, Row, Col, Card, Statistic, List, Tag, Avatar, Spin, Space, Typography, Divider, Empty } from 'antd';
import {
  LoginOutlined, UserAddOutlined, TrophyOutlined, TeamOutlined,
  HeartOutlined, ThunderboltOutlined, FireOutlined, SchoolOutlined,
  RocketOutlined, StarOutlined, BookOutlined, BulbOutlined,
  ArrowDownOutlined, RightOutlined,
} from '@ant-design/icons';
import { adminAPI, petAPI, leaderboardAPI, schoolAPI, classAPI } from '../utils/api';

const { Header, Content, Footer } = Layout;
const { Title, Paragraph, Text } = Typography;

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

const elementColors: Record<string, string> = {
  '火': '#ff4d4f', '水': '#1890ff', '风': '#52c41a', '土': '#d48806',
  '光': '#faad14', '暗': '#722ed1', '火系': '#ff4d4f', '水系': '#1890ff',
  '风系': '#52c41a', '土系': '#d48806', '光系': '#faad14', '暗系': '#722ed1',
};

const getSpeciesImage = (imageUrls: string | object | null): string => {
  try {
    const urls = typeof imageUrls === 'string' ? JSON.parse(imageUrls) : imageUrls;
    if (!urls || typeof urls !== 'object') return '';
    const values = Object.values(urls) as string[];
    return values[0] || '';
  } catch { return ''; }
};

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const statsRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [siteSettings, setSiteSettings] = useState<any>({});
  const [stats, setStats] = useState<any>(null);
  const [species, setSpecies] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [publicClasses, setPublicClasses] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const results = await Promise.allSettled([
      adminAPI.getPublicSettings(),
      adminAPI.getPublicStatistics(),
      petAPI.getSpecies(),
      leaderboardAPI.getLevelLeaderboard({ limit: 10 }),
      schoolAPI.getSchools(),
      classAPI.getPublicClasses(),
    ]);

    const [settingsRes, statsRes, speciesRes, lbRes, schoolsRes, classesRes] = results;

    if (settingsRes.status === 'fulfilled') {
      const s = settingsRes.value.data.settings || {};
      setSiteSettings(s);
      document.title = s.site_name || '班级宠物养成系统';
    }
    if (statsRes.status === 'fulfilled') setStats(statsRes.value.data.statistics);
    if (speciesRes.status === 'fulfilled') setSpecies(speciesRes.value.data.species || []);
    if (lbRes.status === 'fulfilled') setLeaderboard(lbRes.value.data.leaderboard || []);
    if (schoolsRes.status === 'fulfilled') setSchools(schoolsRes.value.data.schools || []);
    if (classesRes.status === 'fulfilled') setPublicClasses(classesRes.value.data.classes || []);

    setLoading(false);
  };

  const scrollToStats = () => {
    statsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
        <Spin size="large"><span style={{ paddingLeft: 16, color: '#666' }}>加载中...</span></Spin>
      </div>
    );
  }

  const features = [
    { icon: <UserAddOutlined />, color: '#667eea', title: '注册加入', desc: '注册账号并加入你的班级，开启专属学习旅程' },
    { icon: <HeartOutlined />, color: '#eb2f96', title: '领养宠物', desc: '选择心仪的宠物伙伴，见证它一步步成长' },
    { icon: <BookOutlined />, color: '#52c41a', title: '完成作业', desc: '完成老师布置的作业，获得经验值和金币奖励' },
    { icon: <ThunderboltOutlined />, color: '#fa541c', title: '对战PK', desc: '和同学的宠物一决高下，用知识的力量战斗' },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Header */}
      <Header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 100,
        padding: isMobile ? '0 12px' : '0 24px',
        height: isMobile ? 56 : 64, position: 'sticky', top: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20 }}>
          <span style={{ fontSize: isMobile ? 22 : 28 }}>{siteSettings.site_logo || '🐾'}</span>
          <span style={{ fontSize: isMobile ? 14 : 18, fontWeight: 'bold', color: '#fff' }}>
            {siteSettings.site_name || '班级宠物养成系统'}
          </span>
        </div>
        <Space size={isMobile ? 8 : 12}>
          <Button type="primary" ghost icon={<LoginOutlined />} size={isMobile ? 'small' : 'middle'} onClick={() => navigate('/login')}>登录</Button>
          <Button icon={<UserAddOutlined />} size={isMobile ? 'small' : 'middle'} style={{ background: '#fff', borderColor: '#fff' }} onClick={() => navigate('/register')}>注册</Button>
        </Space>
      </Header>

      <Content>
        {/* Hero Section */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          padding: isMobile ? '60px 20px 50px' : '100px 40px 80px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.1, backgroundImage: 'radial-gradient(circle at 20% 50%, #fff 1px, transparent 1px), radial-gradient(circle at 80% 20%, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
          <div style={{ position: 'relative', maxWidth: 800, margin: '0 auto' }}>
            <Title style={{ color: '#fff', fontSize: isMobile ? 28 : 44, marginBottom: 16, fontWeight: 700 }}>
              {siteSettings.site_description || '让学习充满乐趣，和同学一起养育专属宠物'}
            </Title>
            <Paragraph style={{ color: 'rgba(255,255,255,0.85)', fontSize: isMobile ? 15 : 18, marginBottom: 36, maxWidth: 600, margin: '0 auto 36px' }}>
              通过完成作业获得经验值，让你的宠物不断成长进化，和全班同学一起在知识的海洋中冒险！
            </Paragraph>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button type="primary" size="large" icon={<RocketOutlined />} style={{ height: isMobile ? 42 : 48, padding: isMobile ? '0 20px' : '0 32px', fontSize: isMobile ? 14 : 16, borderRadius: 8, boxShadow: '0 4px 15px rgba(0,0,0,0.2)', flex: isMobile ? '1 1 40%' : undefined, minWidth: isMobile ? 120 : undefined }} onClick={() => navigate('/register')}>
                立即注册
              </Button>
              <Button size="large" ghost icon={<ArrowDownOutlined />} style={{ height: isMobile ? 42 : 48, padding: isMobile ? '0 20px' : '0 32px', fontSize: isMobile ? 14 : 16, borderRadius: 8, color: '#fff', borderColor: 'rgba(255,255,255,0.6)', flex: isMobile ? '1 1 40%' : undefined, minWidth: isMobile ? 120 : undefined }} onClick={scrollToStats}>
                了解更多
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        {stats && (
          <div ref={statsRef} style={{ maxWidth: 1200, margin: isMobile ? '-30px auto 0' : '-40px auto 0', padding: isMobile ? '0 12px' : '0 24px', position: 'relative', zIndex: 10 }}>
            <Row gutter={[16, 16]}>
              {[
                { icon: <TeamOutlined />, color: '#667eea', value: stats.students, title: '注册学生' },
                { icon: <SchoolOutlined />, color: '#52c41a', value: stats.classes, title: '班级数量' },
                { icon: <HeartOutlined />, color: '#eb2f96', value: stats.pets, title: '宠物总数' },
                { icon: <FireOutlined />, color: '#fa541c', value: stats.battles, title: '战斗次数' },
              ].map((item, idx) => (
                <Col xs={12} sm={6} key={idx}>
                  <Card style={{ borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center', borderTop: `3px solid ${item.color}` }} styles={{ body: { padding: isMobile ? '16px 8px' : '24px 16px' } }}>
                    <div style={{ fontSize: isMobile ? 24 : 32, color: item.color, marginBottom: 8 }}>{item.icon}</div>
                    <Statistic value={item.value} valueStyle={{ color: item.color, fontSize: isMobile ? 22 : 28, fontWeight: 'bold' }} />
                    <div style={{ color: '#8c8c8c', fontSize: 13, marginTop: 4 }}>{item.title}</div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}

        {/* How It Works */}
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '40px 16px' : '60px 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? 24 : 40 }}>
            <Title level={2} style={{ marginBottom: 8, fontSize: isMobile ? 20 : undefined }}>如何开始？</Title>
            <Paragraph style={{ color: '#8c8c8c', fontSize: isMobile ? 14 : 16 }}>简单四步，开启你的宠物养成之旅</Paragraph>
          </div>
          <Row gutter={[24, 24]}>
            {features.map((f, idx) => (
              <Col xs={12} md={6} key={idx}>
                <Card hoverable style={{ borderRadius: 12, textAlign: 'center', height: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }} styles={{ body: { padding: isMobile ? '16px 10px' : '32px 20px' } }}>
                  <div style={{ width: isMobile ? 44 : 56, height: isMobile ? 44 : 56, borderRadius: '50%', background: `${f.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: isMobile ? 20 : 24, color: f.color }}>
                    {f.icon}
                  </div>
                  <div style={{ fontSize: 11, color: '#bbb', marginBottom: 6 }}>第 {idx + 1} 步</div>
                  <Title level={5} style={{ marginBottom: 6, fontSize: isMobile ? 14 : 16 }}>{f.title}</Title>
                  <Paragraph style={{ color: '#666', fontSize: isMobile ? 12 : 13, margin: 0 }}>{f.desc}</Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
        </div>

        {/* Pet Species Catalog */}
        {species.length > 0 && (
          <div style={{ background: '#fff', padding: isMobile ? '40px 16px' : '60px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: isMobile ? 24 : 40 }}>
                <Title level={2} style={{ marginBottom: 8, fontSize: isMobile ? 20 : undefined }}><BulbOutlined style={{ color: '#667eea' }} /> 宠物种类图鉴</Title>
                <Paragraph style={{ color: '#8c8c8c', fontSize: isMobile ? 14 : 16 }}>选择你最喜欢的宠物伙伴，开启冒险旅程</Paragraph>
              </div>
              <Row gutter={[20, 20]}>
                {species.map((sp: any) => (
                  <Col xs={12} sm={8} md={6} key={sp.id}>
                    <Card hoverable style={{ borderRadius: 12, overflow: 'hidden', height: '100%' }}
                      cover={
                        <div style={{ height: isMobile ? 100 : 160, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%)', padding: isMobile ? 10 : 16 }}>
                          <img alt={sp.name} src={getSpeciesImage(sp.image_urls)} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                      }
                      styles={{ body: { padding: isMobile ? '8px 10px' : '12px 16px' } }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 4 }}>
                        <Text strong style={{ fontSize: isMobile ? 13 : 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.name}</Text>
                        {sp.element_type && <Tag color={elementColors[sp.element_type] || '#667eea'} style={{ margin: 0, fontSize: isMobile ? 11 : 12, padding: '0 4px', lineHeight: isMobile ? '18px' : '20px' }}>{sp.element_type}</Tag>}
                      </div>
                      {sp.description && !isMobile && <Paragraph ellipsis={{ rows: 2 }} style={{ color: '#8c8c8c', fontSize: 12, margin: 0 }}>{sp.description}</Paragraph>}
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '40px 16px' : '60px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: isMobile ? 24 : 40 }}>
              <Title level={2} style={{ marginBottom: 8, fontSize: isMobile ? 20 : undefined }}><TrophyOutlined style={{ color: '#faad14' }} /> 全服排行榜</Title>
              <Paragraph style={{ color: '#8c8c8c', fontSize: isMobile ? 14 : 16 }}>看看谁的宠物最强，努力学习冲上榜首！</Paragraph>
            </div>
            <Card style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <List
                dataSource={leaderboard}
                renderItem={(item: any, index: number) => (
                  <List.Item style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center' }}>
                    <List.Item.Meta
                      avatar={
                        <Avatar style={{ background: index === 0 ? '#faad14' : index === 1 ? '#d9d9d9' : index === 2 ? '#d48806' : '#e8e8e8', color: index < 3 ? '#fff' : '#666', fontWeight: 'bold', fontSize: 16, flexShrink: 0 }}>
                          {index + 1}
                        </Avatar>
                      }
                      title={<Text strong>{item.name || item.pet_name || '宠物'}</Text>}
                      description={
                        <Space size={isMobile ? 8 : 16} wrap>
                          <Text type="secondary" style={{ fontSize: isMobile ? 12 : 14 }}>主人：{item.owner_name || item.username || '-'}</Text>
                          <Text type="secondary" style={{ fontSize: isMobile ? 12 : 14 }}>物种：{item.species_name || '-'}</Text>
                        </Space>
                      }
                    />
                    <div style={{ textAlign: isMobile ? 'left' : 'right', marginLeft: isMobile ? 48 : 0, marginTop: isMobile ? 4 : 0 }}>
                      <Space size={12}>
                        <Text strong style={{ color: '#667eea', fontSize: 16 }}>Lv.{item.level}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{item.exp} EXP</Text>
                      </Space>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </div>
        )}

        {/* Schools */}
        {schools.length > 0 && (
          <div style={{ background: '#fff', padding: isMobile ? '40px 16px' : '60px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: isMobile ? 24 : 40 }}>
                <Title level={2} style={{ marginBottom: 8, fontSize: isMobile ? 20 : undefined }}><SchoolOutlined style={{ color: '#52c41a' }} /> 加入学校</Title>
                <Paragraph style={{ color: '#8c8c8c', fontSize: isMobile ? 14 : 16 }}>找到你的学校，和同校同学一起养成宠物</Paragraph>
              </div>
              <Row gutter={[20, 20]}>
                {schools.map((school: any) => {
                  const schoolClasses = publicClasses.filter((c: any) => c.school_id === school.id || c.school_name === school.name);
                  return (
                    <Col xs={24} sm={12} md={8} key={school.id}>
                      <Card hoverable style={{ borderRadius: 12, borderLeft: `4px solid ${school.theme_color || '#667eea'}`, height: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          {school.logo ? <Avatar src={school.logo} size={40} /> : <Avatar style={{ background: school.theme_color || '#667eea' }} size={40} icon={<SchoolOutlined />} />}
                          <div>
                            <Text strong style={{ fontSize: 16 }}>{school.name}</Text>
                            <div style={{ color: '#8c8c8c', fontSize: 12 }}>{school.city || ''}{school.city && school.region ? ' · ' : ''}{school.region || ''}</div>
                          </div>
                        </div>
                        <Space size={16}>
                          <Text type="secondary"><TeamOutlined /> {school.class_count || 0} 个班级</Text>
                          <Text type="secondary"><UserAddOutlined /> {schoolClasses.reduce((sum: number, c: any) => sum + (c.student_count || 0), 0)} 名学生</Text>
                        </Space>
                        {schoolClasses.length > 0 && (
                          <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                            {schoolClasses.slice(0, 3).map((c: any) => (
                              <Tag key={c.id} style={{ marginBottom: 4, cursor: 'pointer' }} onClick={() => navigate(`/c/${c.slug}`)}>
                                {c.name} {c.grade ? `(${c.grade})` : ''} <RightOutlined style={{ fontSize: 10 }} />
                              </Tag>
                            ))}
                            {schoolClasses.length > 3 && <Tag>+{schoolClasses.length - 3} 个班级</Tag>}
                          </div>
                        )}
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </div>
          </div>
        )}

        {/* CTA Section */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: isMobile ? '40px 20px' : '60px 40px',
          textAlign: 'center',
        }}>
          <Title level={2} style={{ color: '#fff', marginBottom: 12, fontSize: isMobile ? 20 : undefined }}>准备好开始了吗？</Title>
          <Paragraph style={{ color: 'rgba(255,255,255,0.85)', fontSize: isMobile ? 14 : 16, marginBottom: 32 }}>
            加入班级宠物养成系统，让学习变得更有趣
          </Paragraph>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button type="primary" size="large" icon={<RocketOutlined />} style={{ height: isMobile ? 42 : 48, padding: isMobile ? '0 20px' : '0 32px', fontSize: isMobile ? 14 : 16, borderRadius: 8, background: '#fff', color: '#667eea', borderColor: '#fff', fontWeight: 600, flex: isMobile ? '1 1 40%' : undefined, minWidth: isMobile ? 120 : undefined }} onClick={() => navigate('/register')}>
              立即注册
            </Button>
            <Button size="large" ghost icon={<LoginOutlined />} style={{ height: isMobile ? 42 : 48, padding: isMobile ? '0 20px' : '0 32px', fontSize: isMobile ? 14 : 16, borderRadius: 8, color: '#fff', borderColor: 'rgba(255,255,255,0.6)', flex: isMobile ? '1 1 40%' : undefined, minWidth: isMobile ? 120 : undefined }} onClick={() => navigate('/login')}>
              已有账号？登录
            </Button>
          </div>
        </div>
      </Content>

      {/* Footer */}
      <Footer style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        color: 'rgba(255,255,255,0.65)', textAlign: 'center',
        padding: isMobile ? '24px 12px' : '32px 50px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>{siteSettings.site_logo || '🐾'}</span>
            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>{siteSettings.site_name || '班级宠物养成系统'}</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 12 }}>
            {siteSettings.site_description || '寓教于乐，让学习更有趣'}
          </p>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
            <span style={{ fontSize: 12 }}>{siteSettings.site_footer || '© 2024 班级宠物养成系统'}</span>
            <span style={{ margin: '0 8px', fontSize: 12 }}>|</span>
            <span style={{ fontSize: 12 }}>用 <HeartOutlined style={{ color: '#ff4d4f' }} /> 打造</span>
          </div>
        </div>
      </Footer>
    </Layout>
  );
};

export default LandingPage;
