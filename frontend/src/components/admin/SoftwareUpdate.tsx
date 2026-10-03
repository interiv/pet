import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Button, Input, message, Tag, Space, Alert, Descriptions, Typography,
  Progress, Popconfirm, Table, Collapse, Empty, Spin,
} from 'antd';
import {
  CloudDownloadOutlined, ReloadOutlined, SafetyCertificateOutlined, HistoryOutlined,
  CloudServerOutlined, WarningOutlined, RollbackOutlined,
} from '@ant-design/icons';
import { adminAPI } from '../../utils/api';

const { Paragraph, Text } = Typography;

const SoftwareUpdate: React.FC = () => {
  const [info, setInfo] = useState<any>(null);
  const [source, setSource] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const loadInfo = useCallback(async () => {
    try {
      const res = await adminAPI.getUpdateInfo();
      setInfo(res.data);
      setSource(res.data.manifestUrl || '');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '获取版本信息失败');
    }
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      const res = await adminAPI.getUpdateBackups();
      setBackups(res.data.backups || []);
    } catch { /* 忽略 */ }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await adminAPI.getUpdateLog();
      setLogs(res.data.logs || []);
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => { loadInfo(); loadBackups(); loadLogs(); }, [loadInfo, loadBackups, loadLogs]);

  // 升级过程中轮询进度
  useEffect(() => {
    if (!applying) return;
    const timer = setInterval(async () => {
      try {
        const res = await adminAPI.getUpdateStatus();
        setProgress(res.data);
        if (!res.data.running && (res.data.phase === 'done' || res.data.phase === 'failed')) {
          clearInterval(timer);
          setApplying(false);
          if (res.data.phase === 'done') {
            message.success('升级完成');
            loadInfo(); loadBackups(); loadLogs();
          }
        }
      } catch { /* 网络抖动忽略 */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [applying, loadInfo, loadBackups, loadLogs]);

  const saveSource = async () => {
    try {
      const res = await adminAPI.setUpdateSource(source.trim());
      message.success(res.data.message);
      loadInfo();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败');
    }
  };

  const doCheck = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.checkUpdate();
      setCheck(res.data);
      if (!res.data.ok) message.error(res.data.error || '检查更新失败');
      else if (!res.data.hasUpdate) message.success('当前已是最新版本');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '检查更新失败');
    } finally {
      setLoading(false);
    }
  };

  const doApply = async () => {
    if (!check?.latest) return;
    setApplying(true);
    setProgress({ phase: 'starting', message: '正在启动升级...', progress: 1 });
    try {
      const res = await adminAPI.applyUpdate(check.latest);
      setProgress({ phase: 'done', message: '升级完成', progress: 100 });
      setLastResult(res.data);
      message.success(res.data.message || '升级完成');
      setCheck(null);
      loadInfo(); loadBackups(); loadLogs();
    } catch (e: any) {
      setProgress({ phase: 'failed', message: e?.response?.data?.error || '升级失败', progress: 100 });
      message.error(e?.response?.data?.error || '升级失败');
      loadLogs();
    } finally {
      setApplying(false);
    }
  };

  const doRollback = async (file: string) => {
    try {
      const res = await adminAPI.rollbackUpdate(file);
      message.success(res.data.message || '回滚完成，请按提示重启服务');
      loadInfo(); loadBackups(); loadLogs();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '回滚失败');
    }
  };

  const doRestart = async () => {
    try {
      const res = await adminAPI.restartService();
      message.success(res.data.message || '服务正在重启');
      setTimeout(() => window.location.reload(), 5000);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '重启失败');
    }
  };

  if (!info) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  const busy = applying || progress?.running;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="本功能用于「服务端文件 + 数据库结构」的一键升级"
        description={
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            流程：先在更新源放好 manifest.json 与升级包 → 填入更新源地址 → 检查更新 → 立即升级。<br />
            升级会自动<b>备份当前程序文件</b>、校验 sha256、只覆盖白名单目录、跑数据库迁移；出问题可在下方「历史备份」一键回滚。<br />
            升级只替换程序文件，<b>不会动数据库与上传文件</b>；数据库结构由随包迁移脚本自动升级。
          </div>
        }
      />

      <Card title={<><CloudServerOutlined /> 当前环境</>} size="small" style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
          <Descriptions.Item label="当前版本"><Tag color="blue">{info.version}</Tag></Descriptions.Item>
          <Descriptions.Item label="部署方式">{info.runtime?.label || '-'}</Descriptions.Item>
          <Descriptions.Item label="运行环境">Node {info.node} / {info.platform}</Descriptions.Item>
          <Descriptions.Item label="提交号">{info.commit || '-'}</Descriptions.Item>
          <Descriptions.Item label="安装目录" span={2}>
            <Text code copyable style={{ fontSize: 12 }}>{info.installDir}</Text>
          </Descriptions.Item>
        </Descriptions>
        {info.runtime && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
            升级后生效方式：
            {info.runtime.canSelfRestart
              ? <Text type="secondary">点「重启服务」按钮即可（由进程管理器托管）。</Text>
              : <Text type="secondary">需手动执行命令 <Text code copyable>{info.runtime.restartCommand}</Text>；{info.runtime.note}</Text>}
          </div>
        )}
      </Card>

      <Card title={<><CloudDownloadOutlined /> 更新源</>} size="small" style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="https://你的域名/releases/manifest.json"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button onClick={saveSource}>保存</Button>
          <Button type="primary" loading={loading} onClick={doCheck} icon={<ReloadOutlined />}>检查更新</Button>
        </Space.Compact>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          更新源地址指向发布清单 manifest.json。生成方式：仓库根目录执行
          <Text code>node scripts/release.mjs --version 1.1.0 --base-url https://你的域名/releases</Text>
          ，把生成的 pet-1.1.0.tar.gz 与 manifest.json 一起上传到该地址所在目录。
        </Paragraph>
      </Card>

      {check && !check.ok && (
        <Alert type="error" showIcon message="检查更新失败" description={check.error} style={{ marginBottom: 16 }} />
      )}

      {check && check.ok && check.hasUpdate && (
        <Card
          title={<><SafetyCertificateOutlined /> 发现新版本 {check.latest}</>}
          size="small"
          style={{ marginBottom: 16, borderColor: '#52c41a' }}
          extra={
            <Popconfirm
              title="确认升级到该版本？"
              description="升级前会自动备份当前程序文件，失败可一键回滚。"
              okText="确认升级"
              cancelText="再想想"
              onConfirm={doApply}
              disabled={busy}
            >
              <Button type="primary" loading={busy} icon={<CloudDownloadOutlined />}>立即升级</Button>
            </Popconfirm>
          }
        >
          <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
            <Tag color="blue">{check.current} → {check.latest}</Tag>
            <Tag>{check.packageSizeText}</Tag>
            {check.requireMigrations && <Tag color="purple">含数据库迁移</Tag>}
            {check.needRestart && <Tag color="orange">需重启服务</Tag>}
            {check.releasedAt && <Tag>发布于 {new Date(check.releasedAt).toLocaleString()}</Tag>}
          </Space>
          {!check.minVersionOk && (
            <Alert type="error" showIcon message="当前版本过低，无法直接升级到该版本" style={{ marginBottom: 12 }} />
          )}
          {check.changelog && (
            <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {check.changelog}
            </div>
          )}
          {check.docker && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
              <WarningOutlined /> Docker 部署建议改用镜像升级：
              <Text code copyable>{check.docker.image ? `docker pull ${check.docker.image} && docker compose up -d` : 'docker compose pull; docker compose up -d'}</Text>
            </div>
          )}
        </Card>
      )}

      {check && check.ok && !check.hasUpdate && (
        <Alert type="success" showIcon message={`当前已是最新版本（${check.current}）`} style={{ marginBottom: 16 }} />
      )}

      {busy && progress && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Progress
            percent={Math.min(100, Math.round(progress.progress || 0))}
            status={progress.phase === 'failed' ? 'exception' : 'active'}
          />
          <div style={{ fontSize: 13, color: '#555' }}>{progress.message || '处理中...'}</div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
            请勿关闭页面或重启服务器。升级过程会下载并校验升级包、备份旧文件、执行数据库迁移。
          </div>
        </Card>
      )}

      {lastResult && (
        <Alert
          type={lastResult.needNpmInstall ? 'warning' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
          message={'升级完成：' + lastResult.from + ' → ' + lastResult.to}
          description={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {lastResult.needNpmInstall && (
                <div>
                  <WarningOutlined /> 本次版本调整了后端依赖，升级包内不含 node_modules，请到服务器执行：
                  <Text code copyable>{lastResult.npmInstallCommand}</Text>
                </div>
              )}
              {(lastResult.appliedMigrations || []).length > 0 && (
                <div>已执行数据库迁移：{lastResult.appliedMigrations.join('、')}</div>
              )}
              {lastResult.backup && <div>已备份旧文件：<Text code>{lastResult.backup}</Text>（有问题可在「历史备份」回滚）</div>}
              <div>
                接下来：
                {lastResult.restart && lastResult.restart.canSelfRestart
                  ? '点下方「重启服务」按钮生效。'
                  : <>在服务器执行 <Text code copyable>{lastResult.restart && lastResult.restart.restartCommand}</Text> 生效。</>}
              </div>
            </div>
          }
        />
      )}

      {info.runtime?.canSelfRestart && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space>
            <Text>升级后需要重启服务才能生效：</Text>
            <Popconfirm title="确认重启服务？重启期间会短暂无法访问。" onConfirm={doRestart} okText="重启" cancelText="取消">
              <Button icon={<ReloadOutlined />}>重启服务</Button>
            </Popconfirm>
            <Text code copyable>{info.runtime.restartCommand}</Text>
          </Space>
        </Card>
      )}

      <Collapse
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'backups',
            label: <span><HistoryOutlined /> 历史备份（可一键回滚）</span>,
            children: (
              <Table
                size="small"
                rowKey="file"
                pagination={false}
                dataSource={backups}
                locale={{ emptyText: <Empty description="还没有备份记录（每次升级会自动备份）" /> }}
                columns={[
                  { title: '备份文件', dataIndex: 'file', key: 'file', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                  { title: '升级前版本', dataIndex: 'from', key: 'from', width: 110, render: (v: string) => <Tag>{v}</Tag> },
                  { title: '大小', dataIndex: 'sizeText', key: 'size', width: 90 },
                  {
                    title: '操作',
                    key: 'op',
                    width: 100,
                    render: (_: any, r: any) => (
                      <Popconfirm
                        title="确认回滚到该备份？"
                        description="只会恢复程序文件，不会回滚数据库。"
                        okText="确认回滚"
                        cancelText="取消"
                        onConfirm={() => doRollback(r.file)}
                      >
                        <Button type="link" size="small" icon={<RollbackOutlined />}>回滚</Button>
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'logs',
            label: <span><HistoryOutlined /> 升级日志</span>,
            children: (
              <Table
                size="small"
                rowKey={(_: any, i?: number) => String(i)}
                pagination={false}
                dataSource={logs}
                locale={{ emptyText: <Empty description="暂无升级记录" /> }}
                columns={[
                  { title: '时间', dataIndex: 'at', key: 'at', width: 190, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
                  { title: '动作', dataIndex: 'action', key: 'action', width: 110, render: (v: string) => <Tag>{v}</Tag> },
                  {
                    title: '详情',
                    key: 'detail',
                    render: (_: any, r: any) => (
                      <Text style={{ fontSize: 12 }} type="secondary">
                        {r.error ? r.error
                          : r.message ? r.message
                          : [r.from && `${r.from} → ${r.to}`, (r.writtenTargets || []).join('、'), r.backup && `备份 ${r.backup}`].filter(Boolean).join('　')}
                      </Text>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export { SoftwareUpdate };
export default SoftwareUpdate;
