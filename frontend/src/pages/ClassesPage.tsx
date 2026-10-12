import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Input, Select, Tag, Space, Button, Statistic, Empty, Typography } from 'antd';
import { TeamOutlined, UserAddOutlined, TrophyOutlined, SearchOutlined, RightOutlined } from '@ant-design/icons';
import DirectoryLayout from '../components/DirectoryLayout';
import { publicAPI } from '../utils/api';

const { Text } = Typography;

/**
 * 班级广场（首页「班级数量」点进来）
 *
 * 与学校页的分工：学校页回答「学校有多大」，这里回答「班养得怎么样」——
 * 所以每张班级卡片除了人数，还带上宠物数、平均等级和班里的头号宠物。
 */
const ClassesPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await publicAPI.getClasses();
        setClasses(res.data.classes || []);
      } catch {
        /* 拉不到就留空态 */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const schoolOptions = useMemo(
    () => [...new Set(classes.map((c) => c.school_name).filter(Boolean))] as string[],
    [classes]
  );
  const gradeOptions = useMemo(
    () => [...new Set(classes.map((c) => c.grade).filter(Boolean))] as string[],
    [classes]
  );

  const filtered = useMemo(() => classes.filter((c) => {
    if (schoolFilter !== 'all' && c.school_name !== schoolFilter) return false;
    if (gradeFilter !== 'all' && c.grade !== gradeFilter) return false;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    return [c.name, c.grade, c.school_name, c.head_teacher_names, c.top_pet_name]
      .filter(Boolean).join(' ').toLowerCase().includes(kw);
  }), [classes, keyword, schoolFilter, gradeFilter]);

  const totals = useMemo(() => classes.reduce((acc, c) => ({
    students: acc.students + (c.student_count || 0),
    pets: acc.pets + (c.pet_count || 0),
  }), { students: 0, pets: 0 }), [classes]);

  return (
    <DirectoryLayout title="班级广场" accent="#722ed1" subtitle={`${classes.length} 个公开班级`} loading={loading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: '班级', value: classes.length, color: '#52c41a' },
          { title: '学生', value: totals.students, color: '#eb2f96' },
          { title: '宠物', value: totals.pets, color: '#722ed1' },
        ].map((it) => (
          <Col xs={8} sm={8} md={6} lg={4} key={it.title}>
            <Card style={{ borderRadius: 10, textAlign: 'center', borderTop: `3px solid ${it.color}` }} styles={{ body: { padding: '14px 8px' } }}>
              <Statistic title={it.title} value={it.value} valueStyle={{ color: it.color, fontSize: 22, fontWeight: 'bold' }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          placeholder="搜索班级 / 学校 / 班主任 / 宠物"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 260, borderRadius: 8 }}
        />
        <Select
          value={schoolFilter}
          onChange={setSchoolFilter}
          style={{ width: 180 }}
          options={[{ value: 'all', label: '全部学校' }, ...schoolOptions.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          value={gradeFilter}
          onChange={setGradeFilter}
          style={{ width: 140 }}
          options={[{ value: 'all', label: '全部年级' }, ...gradeOptions.map((g) => ({ value: g, label: g }))]}
        />
      </Space>

      {filtered.length === 0 ? (
        <Card style={{ borderRadius: 12 }}><Empty description="没有匹配的班级" /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((c: any) => {
            const theme = c.school_theme || '#52c41a';
            return (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card hoverable style={{ borderRadius: 12, borderLeft: `4px solid ${theme}`, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Text strong style={{ fontSize: 16 }}>{c.name}</Text>
                    {c.grade && <Tag color="blue" style={{ margin: 0 }}>{c.grade}</Tag>}
                  </div>
                  <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 10 }}>
                    {c.school_name || '未归属学校'}
                    {/* 后端已把班主任名拆成数组（用 char(31) 分隔，姓名里的逗号不会被误拆），
                        这里统一用「、」连接；兼容早期版本返回的整串 */}
                    {c.head_teacher_names?.length
                      ? ` · 班主任 ${(Array.isArray(c.head_teacher_names) ? c.head_teacher_names : [c.head_teacher_names]).join('、')}`
                      : ''}
                  </div>

                  <Space size={[12, 6]} wrap>
                    <Text type="secondary" style={{ fontSize: 13 }}><UserAddOutlined /> {c.student_count || 0} 人</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}><TeamOutlined /> {c.teacher_count || 0} 位教师</Text>
                  </Space>
                  <div style={{ marginTop: 6, fontSize: 13, color: '#722ed1' }}>
                    🐾 {c.pet_count || 0} 只宠物 · 平均 Lv.{c.avg_level || 0}
                  </div>
                  {c.top_pet_name && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#fa8c16' }}>
                      <TrophyOutlined /> 头号宠物：{c.top_pet_name}
                      {c.top_pet_species ? `（${c.top_pet_species}）` : ''} Lv.{c.max_level || 0}
                    </div>
                  )}

                  <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 10, display: 'flex', gap: 8 }}>
                    <Button size="small" onClick={() => navigate(`/c/${c.slug}`)}>班级主页</Button>
                    <Button size="small" type="primary" ghost onClick={() => navigate(`/c/${c.slug}/pets`)}>
                      班级宠物 <RightOutlined style={{ fontSize: 10 }} />
                    </Button>
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

export default ClassesPage;
