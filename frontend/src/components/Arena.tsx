import React, { useState } from 'react';
import { Tabs } from 'antd';
import { TrophyOutlined, FireOutlined } from '@ant-design/icons';
import Battle from './Battle';
import BossBattle from './BossBattle';

interface ArenaProps {
  defaultTab?: 'pvp' | 'boss';
}

const Arena: React.FC<ArenaProps> = ({ defaultTab = 'pvp' }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

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
      onChange={(key) => setActiveTab(key as 'pvp' | 'boss')}
      items={items}
      destroyInactiveTabPane
    />
  );
};

export default Arena;
