import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Input, Tag, Avatar, Space, Statistic, Empty, Typography } from 'antd';
import { TeamOutlined, UserSwitchOutlined, SearchOutlined, CrownOutlined } from '@ant-design/icons';
import DirectoryLayout from '../components/DirectoryLayout';
import { publicAPI } from '../utils/api';

const { Text } = Typography;

/**
 * 教师团队（首页「在职教师」点进来）
 *
 * 能公开的是姓名 + 任教学校 + 带班情况：教师在校内本来就是公开职务身份。
 * 用户名/邮箱这类登录凭据后端一律不返回，这里也就无从展示。
 */
const TeachersPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await publicAPI.getTeachers();
        setTeachers(res.data.teachers || []);
        setTotals(res.data.totals || {});
      } catch {
        /* 留空态 */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return teachers;
    return teachers.filter((t) =>
      [t.name, ...(t.school_names || []), ...(t.class_names || [])]
        .filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }, [teachers, keyword]);

  return (
    <DirectoryLayout title="教师团队" subtitle={`${teachers.length} 位在职教师`} loading={loading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: '在职教师', value: totals.teacher_count || 0, color: '#fa8c16' },
          { title: '班主任', value: totals.head_teacher_count || 0, color: '#faad14' },
          { title: '覆盖学校', value: totals.school_count || 0, color: '#667eea' },
          { title: '在读学生', value: totals.student_count || 0, color: '#eb2f96' },
        ].map((it) => (
          <Col xs={12} sm={6} key={it.title}>
            <Card style={{ borderRadius: 10, textAlign: 'center', borderTop: `3px solid ${it.color}` }} styles={{ body: { padding: '14px 8px' } }}>
              <Statistic title={it.title} value={it.value} valueStyle={{ color: it.color, fontSize: 22, fontWeight: 'bold' }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        placeholder="搜索教师姓名 / 学校 / 班级"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ maxWidth: 360, marginBottom: 16, borderRadius: 8 }}
      />

      {filtered.length === 0 ? (
        <Card style={{ borderRadius: 12 }}><Empty description="还没有任教中的教师" /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((t: any) => {
            const theme = t.theme_color || '#fa8c16';
            const isHead = (t.head_class_count || 0) > 0;
            return (
              <Col xs={24} sm={12} lg={8} key={t.id}>
                <Card hoverable style={{ borderRadius: 12, borderLeft: `4px solid ${theme}`, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <Avatar style={{ background: theme }} size={44} icon={<UserSwitchOutlined />} />
                    <div style={{ minWidth: 0 }}>
                      <Space size={6} wrap>
                        <Text strong style={{ fontSize: 16 }}>{t.name}</Text>
                        {isHead && <Tag color="gold" icon={<CrownOutlined />} style={{ margin: 0 }}>班主任</Tag>}
                      </Space>
                      <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                        {(t.school_names || []).join('、') || '未归属学校'}
                      </div>
                    </div>
                  </div>

                  <Space size={[12, 6]} wrap>
                    <Text type="secondary" style={{ fontSize: 13 }}><TeamOutlined /> 任教 {t.class_count || 0} 个班</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>👩‍🎓 {t.student_count || 0} 名学生</Text>
                    {isHead && <Text type="secondary" style={{ fontSize: 13 }}>带班 {t.head_class_count} 个</Text>}
                  </Space>

                  {(t.class_names || []).length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {(t.class_names as string[]).map((cn) => (
                        <Tag key={cn} color="blue" style={{ marginBottom: 4 }}>{cn}</Tag>
                      ))}
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </DirectoryLayout>
  );
};

export default TeachersPage;
