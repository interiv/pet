import React, { useState } from 'react';
import { Tabs } from 'antd';
import { MessageOutlined, NotificationOutlined, CommentOutlined, HeartOutlined } from '@ant-design/icons';
import ChatRoom from './ChatRoom';
import Posts from './Posts';
import Forum from './Forum';
import Friends from './Friends';

interface SocialHubProps {
  defaultTab?: 'chat' | 'posts' | 'forum' | 'friends';
}

const SocialHub: React.FC<SocialHubProps> = ({ defaultTab = 'chat' }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const items = [
    {
      key: 'chat',
      label: '群聊',
      icon: <MessageOutlined />,
      children: <ChatRoom />,
    },
    {
      key: 'friends',
      label: '好友',
      icon: <HeartOutlined />,
      children: <Friends />,
    },
    {
      key: 'posts',
      label: '班级动态',
      icon: <NotificationOutlined />,
      children: <Posts />,
    },
    {
      key: 'forum',
      label: '论坛',
      icon: <CommentOutlined />,
      children: <Forum />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as 'chat' | 'posts' | 'forum' | 'friends')}
      items={items}
    />
  );
};

export default SocialHub;
