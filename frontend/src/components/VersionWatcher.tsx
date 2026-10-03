import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import axios from 'axios';

const VERSION_KEY = 'pet_server_version';
const CHECK_INTERVAL = 3 * 60 * 1000; // 3 分钟检查一次

/**
 * 新版本提示：服务端升级后，浏览器里的旧前端不会自动变新
 * （单页应用只在刷新时才重新拉取资源）。这里定时问后端要版本号，
 * 一旦发现服务端换过版本 / 重启过，就引导用户刷新页面。
 */
const VersionWatcher: React.FC = () => {
  const latestRef = useRef<string>('');
  const [newVersion, setNewVersion] = useState<string>('');

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        const res = await axios.get('/api/version', { params: { t: Date.now() }, timeout: 8000 });
        const version = String(res.data?.version || '');
        const startedAt = String(res.data?.startedAt || '');
        if (!version) return;

        const known = localStorage.getItem(VERSION_KEY);
        if (!known) {
          // 首次访问：记录当前版本，不打扰用户
          localStorage.setItem(VERSION_KEY, version);
          latestRef.current = version;
          return;
        }
        if (known !== version) {
          // 服务端代码已换：提示刷新，避免继续用旧前端调新接口
          if (!stopped) setNewVersion(version);
          return;
        }
        // 版本没变但服务重启过（手动重启后前端资源可能变了），也提示一次
        const knownStarted = localStorage.getItem(VERSION_KEY + '_started');
        if (startedAt && knownStarted && knownStarted !== startedAt && !latestRef.current) {
          localStorage.setItem(VERSION_KEY + '_started', startedAt);
        }
        if (startedAt) localStorage.setItem(VERSION_KEY + '_started', startedAt);
      } catch {
        /* 网络不通就忽略，不打扰用户 */
      }
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!newVersion) return null;

  return (
    <Modal
      open
      title={<><CloudDownloadOutlined /> 服务端已升级</>}
      okText="立即刷新"
      cancelText="稍后再说"
      onOk={() => {
        localStorage.setItem(VERSION_KEY, newVersion);
        window.location.reload();
      }}
      onCancel={() => setNewVersion('')}
      closable={false}
      maskClosable={false}
    >
      <Alert
        type="info"
        showIcon
        message={`当前服务端版本：${newVersion}`}
        description="你的页面还是升级前的旧版本，刷新一下就能用上最新功能（不会丢失已填写的内容之外的数据）。"
      />
    </Modal>
  );
};

export { VersionWatcher };
export default VersionWatcher;
