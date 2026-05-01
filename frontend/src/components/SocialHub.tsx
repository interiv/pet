import React from 'react';
import { Tabs } from 'antd';
import { MessageOutlined, NotificationOutlined, CommentOutlined, HeartOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import ChatRoom from './ChatRoom';
import Posts from './Posts';
import Forum from './Forum';
import Friends from './Friends';

const SocialHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'chat';

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

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
      onChange={handleTabChange}
      items={items}
    />
  );
};

export default SocialHub;
