import React, { useEffect, useState } from 'react';
import { Card, Button, Input, message, Tag, Space, Modal, Popconfirm, Row, Col, Statistic, Descriptions, Alert, Empty, Divider, Checkbox } from 'antd';
import { adminAPI } from '../../utils/api';
import { useMobile } from './hooks';

const SystemData: React.FC = () => {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string>('');
  const [status, setStatus] = useState<any>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');
  const [updateNotices, setUpdateNotices] = useState(false);
  const [noticeTouched, setNoticeTouched] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getSystemStatus();
      setStatus(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载系统状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 公告为空 → 默认勾选"同时更新公告"（顺便填上演示账号说明）；
  // 公告已有内容 → 默认不勾，避免覆盖管理员自己写的内容（用户手动改过后不再自动变）
  useEffect(() => {
    if (!status || noticeTouched) return;
    const notices = status.notices || {};
    const isEmpty = !String(notices.site_announcement || '').trim()
      && !String(notices.home_notice || '').trim();
    setUpdateNotices(isEmpty);
  }, [status, noticeTouched]);

  const run = async (key: string, fn: () => Promise<any>) => {
    setAction(key);
    try {
      const res = await fn();
      message.success(res?.data?.message || '操作完成');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败');
    } finally {
      setAction('');
    }
  };

  const handleReset = async () => {
    setAction('reset');
    try {
      const res = await adminAPI.resetSystem(confirmWord);
      message.success(res.data?.message || '系统已重置为全新状态');
      setResetOpen(false);
      // 重置后账号数据全部重建，强制重新登录
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }, 1500);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '重置失败');
    } finally {
      setAction('');
    }
  };

  const migration = status?.migration || {};
  const baseData = status?.baseData || {};
  const counts = status?.counts || {};
  const demo = status?.demo || {};
  const outdated = (migration.pendingCount || 0) > 0;
  const failed = migration.ok === false;
  const confirmRequired = status?.resetConfirmWord || '重置';

  return (
    <div>
      {failed && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="数据库迁移失败，部分功能可能不可用"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>{migration.error}</p>
              <Button size="small" type="primary" loading={action === 'migrate'} onClick={() => run('migrate', adminAPI.runSystemMigrate)}>
                重试迁移
              </Button>
            </div>
          }
        />
      )}

      {!failed && outdated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`检测到 ${migration.pendingCount} 个待执行的数据库迁移`}
          description={
            <div>
              <p style={{ marginBottom: 8 }}>{migration.pending?.join('、')}</p>
              <Button size="small" type="primary" loading={action === 'migrate'} onClick={() => run('migrate', adminAPI.runSystemMigrate)}>
                立即执行迁移
              </Button>
            </div>
          }
        />
      )}

      <Card
        title="数据库结构"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button size="small" loading={loading} onClick={load}>刷新</Button>
            <Button size="small" type="primary" loading={action === 'migrate'} onClick={() => run('migrate', adminAPI.runSystemMigrate)}>
              立即执行迁移
            </Button>
          </Space>
        }
      >
        <Descriptions column={isMobile ? 1 : 2} size="small">
          <Descriptions.Item label="结构状态">
            {failed
              ? <Tag color="red">迁移失败</Tag>
              : outdated
                ? <Tag color="orange">待执行 {migration.pendingCount} 个</Tag>
                : <Tag color="green">已是最新</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="已执行迁移">{migration.completed ?? '-'} 个</Descriptions.Item>
          <Descriptions.Item label="最近执行时间">
            {migration.ranAt ? new Date(migration.ranAt).toLocaleString() : '本次启动未执行'}
          </Descriptions.Item>
          <Descriptions.Item label="最近执行的迁移">
            {migration.applied?.length ? migration.applied.join('、') : '无'}
          </Descriptions.Item>
        </Descriptions>
        <div style={{ color: '#999', fontSize: 12 }}>
          服务启动时会自动执行数据库迁移，正常情况无需手动操作；上传了新版本但未重启时可点「立即执行迁移」。
        </div>
      </Card>

      <Card title="数据概览" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={4}><Statistic title="用户" value={counts.users ?? 0} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="学校" value={counts.schools ?? 0} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="班级" value={counts.classes ?? 0} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="宠物" value={counts.pets ?? 0} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="作业" value={counts.assignments ?? 0} /></Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>基础配置数据（宠物物种 / 物品 / 装备 / 技能 / 成就 / 任务 / 论坛板块）</div>
        <Descriptions column={isMobile ? 1 : 3} size="small">
          <Descriptions.Item label="宠物物种">{baseData.pet_species ?? 0}</Descriptions.Item>
          <Descriptions.Item label="物品">{baseData.items ?? 0}</Descriptions.Item>
          <Descriptions.Item label="装备">{baseData.equipment ?? 0}</Descriptions.Item>
          <Descriptions.Item label="技能">{baseData.skills ?? 0}</Descriptions.Item>
          <Descriptions.Item label="成就">{baseData.achievements ?? 0}</Descriptions.Item>
          <Descriptions.Item label="任务">{baseData.tasks ?? 0}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="演示数据"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button
              size="small"
              type="primary"
              loading={action === 'demo'}
              onClick={() => run('demo', () => adminAPI.importDemoData({ updateNotices }))}
            >
              导入演示数据
            </Button>
            <Popconfirm
              title="确定清除所有演示数据？"
              description="只会删除 demo_ 开头的演示账号及其数据，不影响真实用户。"
              onConfirm={() => run('clear', adminAPI.clearDemoData)}
            >
              <Button size="small" danger disabled={!demo.imported} loading={action === 'clear'}>
                清除演示数据
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 12 }}>
          演示数据使用独立的 <b>{demo.prefix}teacher1 / {demo.prefix}student1</b>（密码 {demo.password || '111111'}）账号，
          与真实账号完全隔离，可随时一键清除。用于快速体验系统各项功能。
        </div>
        <div style={{ marginBottom: 12 }}>
          <Checkbox
            checked={updateNotices}
            onChange={(e) => { setNoticeTouched(true); setUpdateNotices(e.target.checked); }}
          >
            同时更新公告内容（「全局公告」+「首页公告」）
          </Checkbox>
          <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
            勾选后会把这两处公告替换成演示账号说明，方便访客直接看到体验账号；
            清除演示数据时，若公告未被人工修改过会自动还原为空。
            {!(String(status?.notices?.site_announcement || '').trim() === '' && String(status?.notices?.home_notice || '').trim() === '') && (
              <span style={{ color: '#d46b08' }}>（当前公告已有内容，默认不勾选以免覆盖）</span>
            )}
          </div>
        </div>
        {demo.imported ? (
          <Descriptions column={isMobile ? 1 : 3} size="small">
            <Descriptions.Item label="状态"><Tag color="green">已导入</Tag></Descriptions.Item>
            <Descriptions.Item label="演示教师">{demo.teachers ?? 0} 人</Descriptions.Item>
            <Descriptions.Item label="演示学生">{demo.students ?? 0} 人</Descriptions.Item>
            <Descriptions.Item label="演示班级">{demo.classes ?? 0} 个</Descriptions.Item>
            <Descriptions.Item label="宠物">{demo.pets ?? 0} 只</Descriptions.Item>
            <Descriptions.Item label="作业">{demo.assignments ?? 0} 个</Descriptions.Item>
            <Descriptions.Item label="作业提交">{demo.submissions ?? 0} 条</Descriptions.Item>
            <Descriptions.Item label="好友关系">{demo.friends ?? 0} 对</Descriptions.Item>
          </Descriptions>
        ) : (
          <Empty description="暂未导入演示数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>

      <Card title="重置为全新系统" size="small" style={{ borderColor: '#ffccc7' }}>
        <div style={{ marginBottom: 12, color: '#666', fontSize: 12 }}>
          清空所有数据（用户、班级、学校、宠物、作业…），重新初始化表结构与基础配置数据，只保留 <b>admin</b> 账号（密码重置为 <b>111111</b>）。
          <b style={{ color: '#cf1322' }}>此操作不可恢复，建议先备份 data/database.sqlite。</b>
        </div>
        <Button danger onClick={() => { setConfirmWord(''); setResetOpen(true); }}>
          重置为全新系统
        </Button>
      </Card>

      <Modal
        title="重置为全新系统"
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={handleReset}
        okText="确认重置"
        okButtonProps={{ danger: true, loading: action === 'reset', disabled: confirmWord.trim() !== confirmRequired }}
      >
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="该操作会删除系统内所有数据，且无法恢复！"
          description="如需保留数据，请先在服务器上备份 backend/data/database.sqlite 文件。"
        />
        <p>请输入确认词 <b>{confirmRequired}</b> 以继续：</p>
        <Input
          value={confirmWord}
          onChange={(e) => setConfirmWord(e.target.value)}
          placeholder="输入确认词"
          onPressEnter={() => { if (confirmWord.trim() === confirmRequired) handleReset(); }}
        />
      </Modal>
    </div>
  );
};

export { SystemData };
export default SystemData;
