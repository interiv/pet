import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Input, Tag, Avatar, Button, Space, Statistic, Empty, Spin, Typography } from 'antd';
import { TeamOutlined, UserAddOutlined, UserSwitchOutlined, SearchOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import DirectoryLayout from '../components/DirectoryLayout';
import { schoolAPI } from '../utils/api';

const { Text } = Typography;

/**
 * 学校一览（首页「学校数量」点进来）
 *
 * 展示的是「这所学校有多大」：班级数、学生数、教师数，以及新增的宠物数/平均等级。
 * 展开学校卡片可以拿到该校的班级明细，公开班能直接跳班级主页或班级宠物页。
 */
const SchoolsPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [classesMap, setClassesMap] = useState<Record<number, any[]>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await schoolAPI.getSchools();
        setSchools(res.data.schools || []);
      } catch {
        // 列表拉不到就留空，页面给出空态而不是整页报错
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => schools.reduce((acc, s) => ({
    classes: acc.classes + (s.class_count || 0),
    students: acc.students + (s.student_count || 0),
    teachers: acc.teachers + (s.teacher_count || 0),
    pets: acc.pets + (s.pet_count || 0),
  }), { classes: 0, students: 0, teachers: 0, pets: 0 }), [schools]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return schools;
    return schools.filter((s) =>
      [s.name, s.city, s.region, ...(s.grades || [])].filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }, [schools, keyword]);

  const toggleSchool = async (schoolId: number) => {
    if (expanded === schoolId) { setExpanded(null); return; }
    setExpanded(schoolId);
    if (classesMap[schoolId]) return;
    try {
      const res = await schoolAPI.getClassesOfSchool(schoolId);
      setClassesMap((prev) => ({ ...prev, [schoolId]: res.data.classes || [] }));
    } catch {
      setClassesMap((prev) => ({ ...prev, [schoolId]: [] }));
    }
  };

  return (
    <DirectoryLayout title="学校一览" subtitle={`共 ${schools.length} 所学校`} loading={loading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: '学校', value: schools.length, color: '#667eea' },
          { title: '班级', value: totals.classes, color: '#52c41a' },
          { title: '学生', value: totals.students, color: '#eb2f96' },
          { title: '教师', value: totals.teachers, color: '#fa8c16' },
          { title: '宠物', value: totals.pets, color: '#722ed1' },
        ].map((it) => (
          <Col xs={12} sm={8} md={4} key={it.title}>
            <Card style={{ borderRadius: 10, textAlign: 'center', borderTop: `3px solid ${it.color}` }} styles={{ body: { padding: '14px 8px' } }}>
              <Statistic title={it.title} value={it.value} valueStyle={{ color: it.color, fontSize: 22, fontWeight: 'bold' }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        placeholder="搜索学校名称 / 地区 / 年级"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ maxWidth: 360, marginBottom: 16, borderRadius: 8 }}
      />

      {filtered.length === 0 ? (
        <Card style={{ borderRadius: 12 }}><Empty description="没有匹配的学校" /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((school: any) => {
            const theme = school.theme_color || '#667eea';
            return (
              <Col xs={24} sm={12} md={8} key={school.id}>
                <Card hoverable style={{ borderRadius: 12, borderLeft: `4px solid ${theme}`, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    {school.logo
                      ? <Avatar src={school.logo} size={44} />
                      : <Avatar style={{ background: theme }} size={44} icon={<TeamOutlined />} />}
                    <div style={{ minWidth: 0 }}>
                      <Text strong style={{ fontSize: 16 }}>{school.name}</Text>
                      <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                        {[school.city, school.region].filter(Boolean).join(' · ') || '未填写地区'}
                      </div>
                    </div>
                  </div>

                  <Space size={[12, 6]} wrap>
                    <Text type="secondary" style={{ fontSize: 13 }}><TeamOutlined /> {school.class_count || 0} 个班</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}><UserAddOutlined /> {school.student_count || 0} 名学生</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}><UserSwitchOutlined /> {school.teacher_count || 0} 位教师</Text>
                  </Space>
                  <div style={{ marginTop: 6, fontSize: 13, color: '#722ed1' }}>
                    🐾 {school.pet_count || 0} 只宠物
                    {school.avg_level ? ` · 平均 Lv.${school.avg_level}` : ''}
                  </div>

                  {(school.grades || []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {(school.grades as string[]).map((g) => <Tag key={g} color="blue" style={{ marginBottom: 4 }}>{g}</Tag>)}
                    </div>
                  )}

                  <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
                    <Button type="link" size="small" style={{ padding: 0, color: theme }} onClick={() => toggleSchool(school.id)}>
                      {expanded === school.id ? '收起班级' : `查看班级 (${school.class_count || 0})`}
                      <DownOutlined style={{ fontSize: 10, marginLeft: 4, transform: expanded === school.id ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
                    </Button>

                    {expanded === school.id && (
                      <div style={{ marginTop: 8 }}>
                        {classesMap[school.id] === undefined ? (
                          <Spin size="small"><span style={{ paddingLeft: 8, color: '#999', fontSize: 12 }}>加载中…</span></Spin>
                        ) : classesMap[school.id].length === 0 ? (
                          <div style={{ color: '#999', fontSize: 12, padding: '6px 0' }}>该校暂未创建班级</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {classesMap[school.id].map((c: any) => (
                              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#fafafa', borderRadius: 6, flexWrap: 'wrap' }}>
                                <span
                                  style={{ fontSize: 13, color: '#333', fontWeight: 500, cursor: c.slug ? 'pointer' : 'default' }}
                                  onClick={() => c.slug && navigate(`/c/${c.slug}`)}
                                >
                                  {c.name}
                                </span>
                                {c.grade && <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{c.grade}</Tag>}
                                <span style={{ fontSize: 11, color: '#999' }}>{c.student_count || 0} 人</span>
                                {c.slug ? (
                                  <Space size={4} style={{ marginLeft: 'auto' }}>
                                    <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => navigate(`/c/${c.slug}`)}>
                                      主页 <RightOutlined style={{ fontSize: 10 }} />
                                    </Button>
                                    <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => navigate(`/c/${c.slug}/pets`)}>
                                      宠物 <RightOutlined style={{ fontSize: 10 }} />
                                    </Button>
                                  </Space>
                                ) : (
                                  <Tag style={{ margin: '0 0 0 auto', fontSize: 10, color: '#999' }}>未公开</Tag>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </DirectoryLayout>
  );
};

export default SchoolsPage;
