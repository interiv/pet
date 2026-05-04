import React from 'react';
import { Tabs } from 'antd';
import { TrophyOutlined, FireOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import Battle from './Battle';
import BossBattle from './BossBattle';

const Arena: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'pvp';

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

  const items = [
    {
      key: 'pvp',
      label: 'PVP 对战',
      icon: <TrophyOutlined />,
      children: <Battle />,
    },
    {
      key: 'boss',
      label: 'BOSS 战',
      icon: <FireOutlined />,
      children: <BossBattle />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={items}
      destroyOnHidden
    />
  );
};

export default Arena;
