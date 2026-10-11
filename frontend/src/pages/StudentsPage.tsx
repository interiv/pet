import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Input, Tag, Alert, Space, Statistic, Empty, Progress, Typography, Table, Button } from 'antd';
import { UserAddOutlined, TrophyOutlined, SearchOutlined, RightOutlined } from '@ant-design/icons';
import DirectoryLayout from '../components/DirectoryLayout';
import { publicAPI } from '../utils/api';

const { Text } = Typography;

const BUCKET_COLORS: Record<string, string> = {
  '1-4 级': '#bfbfbf',
  '5-9 级': '#52c41a',
  '10-19 级': '#1890ff',
  '20-29 级': '#722ed1',
  '30 级以上': '#fa8c16',
};
const BUCKET_ORDER = ['1-4 级', '5-9 级', '10-19 级', '20-29 级', '30 级以上'];

/**
 * 学生风采（首页「在校学生」点进来）
 *
 * 这一页从头到尾不出现任何一个学生姓名——学生是未成年人，
 * 公开接口只给聚合数字。要看「谁的宠物」请进班级宠物页（那里同样是脱敏的）。
 */
const StudentsPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await publicAPI.getStudentsOverview();
        setData(res.data);
      } catch {
        /* 留空态 */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = data?.totals || {};
  const schools = data?.schools || [];
  const classes = data?.classes || [];

  // 等级分布：后端按 bucket 聚合，这里按固定顺序排好并算出占比
  const distribution = useMemo(() => {
    const raw: any[] = data?.level_distribution || [];
    const max = Math.max(1, ...raw.map((d) => d.count || 0));
    return BUCKET_ORDER
      .map((bucket) => {
        const hit = raw.find((d) => d.bucket === bucket);
        return { bucket, count: hit?.count || 0, percent: Math.round(((hit?.count || 0) / max) * 100) };
      })
      .filter((d) => d.count > 0);
  }, [data]);

  const filteredClasses = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return classes;
    return classes.filter((c: any) =>
      [c.name, c.grade, c.school_name].filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }, [classes, keyword]);

  return (
    <DirectoryLayout title="学生风采" subtitle={`${totals.student_count || 0} 名在校学生`} loading={loading}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, borderRadius: 8 }}
        message="本页只展示聚合统计，不出现任何学生姓名"
        description="学生信息属于未成年人隐私，公开页面一律只给规模与养成情况。教师登录后可在本班看到真实名单。"
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: '在校学生', value: totals.student_count || 0, color: '#eb2f96' },
          { title: '已领养宠物', value: totals.pet_count || 0, color: '#722ed1' },
          { title: '领养率', value: totals.adoption_rate || 0, suffix: '%', color: '#52c41a' },
          { title: '平均等级', value: totals.avg_level || 0, color: '#1890ff' },
          { title: '最高等级', value: totals.max_level || 0, color: '#fa8c16' },
          { title: '金币存量', value: totals.total_gold || 0, color: '#faad14' },
        ].map((it) => (
          <Col xs={12} sm={8} md={4} key={it.title}>
            <Card style={{ borderRadius: 10, textAlign: 'center', borderTop: `3px solid ${it.color}` }} styles={{ body: { padding: '14px 8px' } }}>
              <Statistic
                title={it.title}
                value={it.value}
                suffix={it.suffix}
                valueStyle={{ color: it.color, fontSize: 22, fontWeight: 'bold' }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {distribution.length > 0 && (
        <Card title="宠物等级分布" style={{ borderRadius: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {distribution.map((d) => (
              <div key={d.bucket} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 80, fontSize: 13, color: '#555', flexShrink: 0 }}>{d.bucket}</span>
                <Progress
                  percent={d.percent}
                  showInfo={false}
                  strokeColor={BUCKET_COLORS[d.bucket]}
                  style={{ flex: 1, margin: 0 }}
                />
                <span style={{ width: 50, textAlign: 'right', fontSize: 13, color: '#888' }}>{d.count} 只</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="各校学生规模" style={{ borderRadius: 12, marginBottom: 16 }}>
        {schools.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Row gutter={[12, 12]}>
            {schools.map((s: any) => {
              const theme = s.theme_color || '#667eea';
              const rate = s.student_count > 0 ? Math.round((s.pet_count / s.student_count) * 100) : 0;
              return (
                <Col xs={24} sm={12} md={8} key={s.id}>
                  <div style={{ border: '1px solid #f0f0f0', borderLeft: `4px solid ${theme}`, borderRadius: 10, padding: 14, background: '#fafafa' }}>
                    <Text strong style={{ fontSize: 15 }}>{s.name}</Text>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#666' }}>
                      <span><UserAddOutlined /> {s.student_count || 0} 名学生 · {s.class_count || 0} 个班</span>
                      <span>🐾 {s.pet_count || 0} 只宠物 · 领养率 {rate}%</span>
                      <span><TrophyOutlined /> 平均 Lv.{s.avg_level || 0}</span>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Card
        title="各班学生与宠物"
        extra={<Text type="secondary" style={{ fontSize: 12 }}>点击「宠物」查看该班宠物列表</Text>}
        style={{ borderRadius: 12 }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          placeholder="搜索班级 / 学校 / 年级"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ maxWidth: 320, marginBottom: 12, borderRadius: 8 }}
        />
        {filteredClasses.length === 0 ? (
          <Empty description="暂无班级数据" />
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 10, size: 'small' }}
            dataSource={filteredClasses}
            columns={[
              {
                title: '班级', dataIndex: 'name',
                render: (v: string, r: any) => (
                  <Space size={6}>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                    {r.grade && <Tag color="blue" style={{ margin: 0 }}>{r.grade}</Tag>}
                  </Space>
                ),
              },
              { title: '学校', dataIndex: 'school_name', render: (v: string) => v || '-' },
              { title: '学生', dataIndex: 'student_count', width: 80, sorter: (a: any, b: any) => (a.student_count || 0) - (b.student_count || 0) },
              { title: '宠物', dataIndex: 'pet_count', width: 80, sorter: (a: any, b: any) => (a.pet_count || 0) - (b.pet_count || 0) },
              { title: '平均等级', dataIndex: 'avg_level', width: 100, render: (v: number) => `Lv.${v || 0}` },
              {
                title: '操作', width: 90,
                render: (_: any, r: any) => (
                  <Button size="small" type="link" style={{ padding: 0 }} disabled={!r.slug} onClick={() => navigate(`/c/${r.slug}/pets`)}>
                    宠物 <RightOutlined style={{ fontSize: 10 }} />
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
    </DirectoryLayout>
  );
};

export default StudentsPage;
