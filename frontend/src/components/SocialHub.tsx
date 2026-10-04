import React from 'react';
import { Tabs, Tag } from 'antd';
import { MessageOutlined, NotificationOutlined, CommentOutlined, HeartOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import ChatRoom from './ChatRoom';
import Posts from './Posts';
import Forum from './Forum';
import Friends from './Friends';
import { useAuthStore } from '../store/authStore';

/**
 * 「沟通 / 班级」是各角色共用的同一个社交中心（菜单 key 都是 social，学生端叫「班级」、
 * 教师端叫「沟通」）。内容按角色分层：
 *
 *   学生       —— 群聊只显示自己所在班；班级动态以本班同学为主
 *   教师/班主任 —— 群聊只显示自己任教的班（可带多个班）；班主任还能清理本班学生的动态与帖子
 *   管理员     —— 可查看全部班级群，帖子/动态可跨班删除
 *
 * 实际可见范围一律由后端按 user_id / class_id / class_teachers 判定，
 * 前端只负责把「你看到的是什么、你能删什么」讲清楚。
 */
const SocialHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const activeTab = searchParams.get('tab') || 'chat';

  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';
  const isHeadTeacher = (user as any)?.teacher_classes?.some((c: any) => c.class_role === 'head_teacher');

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

  const chatLabel = isStudent ? '班级群聊' : '任教班级群';
  const chatHint = isAdmin
    ? '管理员可见全部班级群'
    : isStudent
      ? '只显示你所在班级的群'
      : '只显示你任教的班级群';

  const roleTip = isStudent
    ? '这里的动态和帖子，只有你自己发的才能删除。'
    : isAdmin
      ? '管理员可以删除任意班级发的动态和帖子。'
      : isHeadTeacher
        ? '作为班主任，你还能删除本班学生发的动态和帖子；任课教师只能删除自己发的。'
        : '你只能删除自己发的动态和帖子；本班学生的内容由班主任或管理员处理。';

  const items = [
    {
      key: 'chat',
      label: (
        <span>
          {chatLabel}
          <Tag style={{ marginLeft: 6, fontWeight: 400 }}>{chatHint}</Tag>
        </span>
      ),
      icon: <MessageOutlined />,
      children: <ChatRoom />,
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
    {
      key: 'friends',
      label: '好友',
      icon: <HeartOutlined />,
      children: <Friends />,
    },
  ];

  return (
    <>
      <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>{roleTip}</div>
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={items}
      />
    </>
  );
};

export default SocialHub;
