import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Tag, Button, Space, Progress, Empty, Spin, Result,
  Input, Select, Statistic, Typography, Tooltip, Alert,
} from 'antd';
import {
  TeamOutlined, TrophyOutlined, ThunderboltOutlined, HeartOutlined,
  SmileOutlined, CoffeeOutlined, SearchOutlined, ArrowLeftOutlined,
  GoldOutlined, StarOutlined, HomeOutlined, LoginOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { classAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { getPetImageUrl, growthStageEmoji, elementColor, elementLabels, petStatusMeta } from '../utils/petImage';

const { Title, Text } = Typography;

/** 四条状态条统一阈值：<30 标红告警，与宠物面板的告警口径一致 */
const WARN_THRESHOLD = 30;

const StatBar: React.FC<{ icon: React.ReactNode; label: string; value: number; color: string }> = ({ icon, label, value, color }) => {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const danger = v < WARN_THRESHOLD;
  return (
    <div style={{ flex: '1 1 45%', minWidth: 70 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: danger ? '#f5222d' : '#8c8c8c' }}>
        {icon}<span>{label}</span>
      </div>
      <Progress
        percent={v}
        size="small"
        showInfo={false}
        strokeColor={danger ? '#f5222d' : color}
        style={{ margin: 0 }}
      />
      <div style={{ fontSize: 11, color: danger ? '#f5222d' : '#666', textAlign: 'right' }}>{v}</div>
    </div>
  );
};

/**
 * 班级宠物列表（/c/:slug/pets）
 *
 * 两个使用场景：
 *   1. 老师/本班学生 — 打开就是「我班所有宠物现在什么状态」，能直接看出谁需要照顾；
 *   2. 访客 — 不登录也能看到班级养宠成果，主人名由后端脱敏成「张*」。
 *
 * 金币只对本班成员/管理员可见：后端对访客把 gold、total_gold 一律置为 null，
 * 前端据此不渲染（与 backend/src/routes/public.js 的隐私红线一致）。
 */
const ClassPetsPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [cls, setCls] = useState<any>(null);
  const [pets, setPets] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [isMember, setIsMember] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('level');

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await classAPI.getPetsBySlug(slug);
        setCls(res.data.class);
        setPets(res.data.pets || []);
        setStats(res.data.stats || {});
        setIsMember(Boolean(res.data.is_member));
      } catch (e: any) {
        /**
         * 只有 404 才是「班级不存在」。500、超时、断网同样会落进 catch，
         * 原来一律被兜底成 notFound → 页面显示「班级不存在或未公开」，
         * 于是服务重启、数据库锁、网络抖一下都被说成「班级没了」，
         * 老师刷新一百次也没用，连重试的念头都不会有。
         * 现在区分开：真 404 才算找不到，其余当作加载失败并给出重试。
         */
        if (e?.response?.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(e?.response?.data?.error || e?.message || '加载失败，请检查网络后重试');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = pets.filter((p) => {
      if (statusFilter === 'unconscious' && p.status !== 'unconscious') return false;
      if (statusFilter === 'need_care' && !(
        (p.stamina ?? 100) < WARN_THRESHOLD ||
        (p.health ?? 100) < WARN_THRESHOLD ||
        (p.hunger ?? 100) < WARN_THRESHOLD
      )) return false;
      if (!kw) return true;
      return [p.pet_name, p.owner_name, p.species_name].filter(Boolean).join(' ').toLowerCase().includes(kw);
    });
    const cmp: Record<string, (a: any, b: any) => number> = {
      level: (a, b) => (b.level || 0) - (a.level || 0),
      exp: (a, b) => (b.total_exp || 0) - (a.total_exp || 0),
      gold: (a, b) => (b.gold || 0) - (a.gold || 0),
      stamina: (a, b) => (b.stamina ?? 0) - (a.stamina ?? 0),
    };
    list = [...list].sort(cmp[sortBy] || cmp.level);
    return list;
  }, [pets, keyword, statusFilter, sortBy]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
        <Spin size="large"><span style={{ paddingLeft: 16, color: '#999' }}>加载班级宠物...</span></Spin>
      </div>
    );
  }

  if (notFound) {
    return (
      <Result
        status="404"
        title="班级不存在或未公开"
        subTitle="该班级链接可能已失效，或班主任尚未把班级设为公开"
        extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
      />
    );
  }

  // 加载失败（500 / 超时 / 断网）：与「班级不存在」严格分开，给得出下一步动作
  if (loadError || !cls) {
    return (
      <Result
        status="warning"
        title="加载失败"
        subTitle={loadError || '班级信息未加载成功'}
        extra={[
          <Button key="retry" type="primary" onClick={() => window.location.reload()}>重试</Button>,
          <Button key="home" onClick={() => navigate('/')}>返回首页</Button>,
        ]}
      />
    );
  }

  const theme = cls.school_theme || '#667eea';

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{
        background: theme, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', height: 56, position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ color: '#fff' }} />
          <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')} style={{ color: '#fff' }} />
          <span style={{ fontSize: 16, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            {cls.school_name ? `${cls.school_name} · ` : ''}{cls.name}
          </span>
          {cls.grade && <Tag color="gold" style={{ margin: 0 }}>{cls.grade}</Tag>}
          <span style={{ fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap' }}>班级宠物</span>
        </div>
        <Space size={8}>
          {isAuthenticated ? (
            <>
              <span style={{ fontSize: 13, opacity: 0.85 }}>{user?.real_name || user?.username}</span>
              <Button type="text" icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/'); }} style={{ color: '#fff' }} />
            </>
          ) : (
            <Button type="primary" ghost size="small" icon={<LoginOutlined />} onClick={() => navigate('/login')}>登录</Button>
          )}
        </Space>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 12px 40px' }}>
        {/* 班级概览 */}
        <Card style={{ borderRadius: 12, marginBottom: 16, borderLeft: `4px solid ${theme}` }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={8}>
              <Title level={4} style={{ margin: 0 }}>
                <TeamOutlined /> {cls.name}
              </Title>
              <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
                {cls.school_name || '未归属学校'}
                {cls.head_teacher_names?.length ? ` · 班主任 ${cls.head_teacher_names.join('、')}` : ''}
              </div>
            </Col>
            {[
              { title: '班级人数', value: stats.student_count || 0, color: '#eb2f96' },
              { title: '宠物数量', value: stats.pet_count || 0, color: '#722ed1' },
              { title: '平均等级', value: stats.avg_level || 0, color: '#1890ff' },
              { title: '累计积分', value: stats.total_exp || 0, color: '#fa8c16' },
              // 金币只对班级成员下发（后端对访客给 null），访客不渲染这一格
              ...(stats.total_gold == null ? [] : [{ title: '金币合计', value: stats.total_gold, color: '#faad14' }]),
            ].map((it) => (
              <Col xs={12} sm={8} md={3} key={it.title}>
                <Statistic title={it.title} value={it.value} valueStyle={{ color: it.color, fontSize: 20, fontWeight: 'bold' }} />
              </Col>
            ))}
          </Row>

          {(stats.unconscious_count > 0 || stats.need_care_count > 0) && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12, borderRadius: 8 }}
              message="有宠物需要照顾"
              description={
                <span>
                  {stats.unconscious_count > 0 && <>濒死 <b>{stats.unconscious_count}</b> 只　</>}
                  {stats.need_care_count > 0 && <>体力/健康/饱腹低于 30 的 <b>{stats.need_care_count}</b> 只</>}
                </span>
              }
            />
          )}
        </Card>

        {/* 工具栏 */}
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索宠物名 / 主人 / 物种"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 240, borderRadius: 8 }}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'unconscious', label: '濒死' },
              { value: 'need_care', label: '需要照顾' },
            ]}
          />
          <Select
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 140 }}
            options={[
              { value: 'level', label: '按等级排序' },
              { value: 'exp', label: '按积分排序' },
              { value: 'gold', label: '按金币排序' },
              { value: 'stamina', label: '按体力排序' },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>共 {filtered.length} 只</Text>
        </Space>

        {!isMember && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, borderRadius: 8 }}
            message="访客视图：主人姓名已脱敏"
            description="登录后（本班成员或任课教师）可看到主人真实姓名。"
          />
        )}

        {filtered.length === 0 ? (
          <Card style={{ borderRadius: 12 }}>
            <Empty description={pets.length === 0 ? '这个班还没有同学领养宠物' : '没有符合条件的宠物'} />
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {filtered.map((p: any) => {
              const status = petStatusMeta(p.status);
              // 按宠物当前成长阶段取图，蛋就该显示蛋，不要统一用成年期
              const speciesImg = getPetImageUrl(p);
              return (
                <Col xs={24} sm={12} md={8} lg={6} key={p.id}>
                  <Card
                    hoverable
                    style={{ borderRadius: 12, height: '100%', borderTop: `3px solid ${status.color}` }}
                    styles={{ body: { padding: 14 } }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: 10, flexShrink: 0,
                        background: 'linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      }}>
                        {speciesImg
                          ? <img src={speciesImg} alt={p.species_name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : <span style={{ fontSize: 26 }}>{growthStageEmoji(p.growth_stage)}</span>}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <Text strong ellipsis style={{ fontSize: 15, maxWidth: 120 }}>{p.pet_name}</Text>
                          <Tag color={status.color} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>{status.label}</Tag>
                        </div>
                        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
                          {growthStageEmoji(p.growth_stage)} {p.growth_stage || '未知阶段'}
                          {p.species_name ? ` · ${p.species_name}` : ''}
                          {p.element_type && (
                            <Tag color={elementColor(p.element_type)} style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                              {elementLabels[p.element_type] || p.element_type}
                            </Tag>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          主人：{p.owner_name || '-'}
                        </div>
                      </div>
                    </div>

                    <Row align="middle" gutter={8} style={{ marginBottom: 8 }}>
                      <Col flex="auto">
                        <Progress
                          percent={p.exp_progress || 0}
                          size="small"
                          strokeColor="#667eea"
                          format={() => `Lv.${p.level || 1}`}
                        />
                      </Col>
                      <Col>
                        <Tooltip title="累计积分">
                          <span style={{ fontSize: 12, color: '#fa8c16', whiteSpace: 'nowrap' }}>
                            <StarOutlined /> {p.total_exp || 0}
                          </span>
                        </Tooltip>
                      </Col>
                      {/* 访客看不到金币（后端给 null），整格不渲染而不是显示 0 */}
                      {p.gold != null && (
                        <Col>
                          <Tooltip title="主人金币">
                            <span style={{ fontSize: 12, color: '#faad14', whiteSpace: 'nowrap' }}>
                              <GoldOutlined /> {p.gold}
                            </span>
                          </Tooltip>
                        </Col>
                      )}
                    </Row>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px' }}>
                      <StatBar icon={<ThunderboltOutlined />} label="体力" value={p.stamina} color="#722ed1" />
                      <StatBar icon={<HeartOutlined />} label="健康" value={p.health} color="#eb2f96" />
                      <StatBar icon={<SmileOutlined />} label="心情" value={p.mood} color="#faad14" />
                      <StatBar icon={<CoffeeOutlined />} label="饱腹" value={p.hunger} color="#1890ff" />
                    </div>

                    <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999' }}>
                      <span>⚔️ {p.attack ?? 0} / 🛡️ {p.defense ?? 0} / 💨 {p.speed ?? 0}</span>
                      <Tooltip title={`${p.win_count || 0} 胜 / ${p.total_battles || 0} 场`}>
                        <span><TrophyOutlined /> {p.win_count || 0}/{p.total_battles || 0}</span>
                      </Tooltip>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Space>
            <Button onClick={() => navigate(`/c/${cls.slug}`)}>班级主页</Button>
            {isAuthenticated && isMember && (
              <Button type="primary" onClick={() => navigate(`/c/${cls.slug}/app`)}>进入班级工作台</Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
};

export default ClassPetsPage;
