import React, { useEffect, useState } from 'react';
import { Card, List, Badge, Button, Tag, Empty, Spin, Popconfirm, Tabs, message } from 'antd';
import {
  BellOutlined,
  CheckOutlined,
  DeleteOutlined,
  ClearOutlined,
  MessageOutlined,
  HeartOutlined,
  GiftOutlined,
  TrophyOutlined,
  UserAddOutlined,
  NotificationOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { notificationAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  friend_request: { icon: <UserAddOutlined />, color: 'blue', label: '好友请求' },
  friend_accepted: { icon: <UserAddOutlined />, color: 'green', label: '好友通过' },
  gift_received: { icon: <GiftOutlined />, color: 'magenta', label: '收到礼物' },
  achievement: { icon: <TrophyOutlined />, color: 'gold', label: '成就解锁' },
  post_like: { icon: <HeartOutlined />, color: 'red', label: '动态被赞' },
  post_comment: { icon: <MessageOutlined />, color: 'cyan', label: '动态评论' },
  forum_reply: { icon: <MessageOutlined />, color: 'purple', label: '论坛回复' },
  forum_like: { icon: <HeartOutlined />, color: 'red', label: '论坛点赞' },
  forum_quote: { icon: <MessageOutlined />, color: 'orange', label: '被引用' },
  system: { icon: <NotificationOutlined />, color: 'default', label: '系统通知' },
};

interface NotificationItem {
  id: number;
  user_id: number;
  type: string;
  title: string;
  content?: string;
  source_type?: string;
  source_id?: number;
  is_read: number;
  read_at?: string;
  created_at: string;
}

const Notifications: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByType, setUnreadByType] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');

  useEffect(() => {
    if (isAuthenticated) {
      loadUnreadCount();
      loadNotifications();
    }
  }, [isAuthenticated, activeTab]);

  const loadUnreadCount = async () => {
    try {
      const res = await notificationAPI.getUnreadCount();
      setUnreadCount(res.data.total);
      setUnreadByType(res.data.by_type || {});
    } catch (e) {
      console.error('获取未读数失败:', e);
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (activeTab !== 'all') params.type = activeTab;

      const res = await notificationAPI.getNotifications(params);
      setNotifications(res.data.notifications || []);
    } catch (e) {
      console.error('加载通知失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (id: number) => {
    try {
      await notificationAPI.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: 1, read_at: new Date().toISOString() } : n)
      );
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (e) {
      message.error('操作失败');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1, read_at: new Date().toISOString() })));
      setUnreadCount(0);
      setUnreadByType({});
      message.success('全部已读');
    } catch (e) {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await notificationAPI.deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (!notifications.find(n => n.id === id)?.is_read) {
        setUnreadCount(Math.max(0, unreadCount - 1));
      }
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleClearRead = async () => {
    try {
      await notificationAPI.clearReadNotifications();
      setNotifications(prev => prev.filter(n => !n.is_read));
      message.success('已清空已读通知');
    } catch (e) {
      message.error('清空失败');
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 40 }}>
        <Empty description="登录后查看通知" />
      </Card>
    );
  }

  const tabItems = [
    { key: 'all', label: `全部 ${unreadCount > 0 ? `(${unreadCount})` : ''}` },
    { key: 'friend_request', label: `好友 ${unreadByType.friend_request || ''}`.trim() || '好友' },
    { key: 'gift_received', label: `礼物 ${unreadByType.gift_received || ''}`.trim() || '礼物' },
    { key: 'achievement', label: `成就 ${unreadByType.achievement || ''}`.trim() || '成就' },
    { key: 'post_like', label: `赞 ${unreadByType.post_like || ''}`.trim() || '赞' },
    { key: 'forum_reply', label: `论坛 ${unreadByType.forum_reply || ''}`.trim() || '论坛' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>
          <Badge count={unreadCount} size="small">
            <BellOutlined style={{ marginRight: 8 }} />
          </Badge>
          通知中心
        </h2>
        <Space>
          {unreadCount > 0 && (
            <Button size="small" onClick={handleMarkAllAsRead}>
              全部标为已读
            </Button>
          )}
          <Button size="small" onClick={handleClearRead}>
            清空已读
          </Button>
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }} style={{ borderRadius: 12 }}>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k)}
          items={tabItems}
          size="small"
          style={{ paddingLeft: 16 }}
        />

        <Spin spinning={loading}>
          {notifications.length === 0 ? (
            <Empty description="暂无通知" style={{ padding: 40 }} />
          ) : (
            <List
              dataSource={notifications}
              renderItem={(notif: NotificationItem) => {
                const config = typeConfig[notif.type] || { icon: <NotificationOutlined />, color: 'default', label: notif.type };
                return (
                  <List.Item
                    style={{
                      background: notif.is_read ? 'transparent' : '#f6ffed',
                      borderBottom: '1px solid #f5f5f5',
                      padding: '14px 20px',
                      cursor: notif.is_read ? 'default' : 'pointer',
                    }}
                    actions={[
                      !notif.is_read && (
                        <Button
                          type="link"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => handleMarkAsRead(notif.id)}
                        >
                          已读
                        </Button>
                      ),
                      <Popconfirm
                        title="确定删除此通知？"
                        onConfirm={() => handleDelete(notif.id)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>,
                    ]}
                    onClick={() => !notif.is_read && handleMarkAsRead(notif.id)}
                  >
                    <List.Item.Meta
                      avatar={
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: notif.is_read ? '#f5f5f5' : '#e6f7ff',
                            fontSize: 18,
                            flexShrink: 0,
                          }}
                        >
                          {config.icon}
                        </div>
                      }
                      title={
                        <Space size={6}>
                          <span style={{ fontWeight: notif.is_read ? 400 : 600 }}>{notif.title}</span>
                          {!notif.is_read && <Badge status="processing" />}
                          <Tag color={config.color} style={{ fontSize: 10, margin: 0 }}>{config.label}</Tag>
                        </Space>
                      }
                      description={
                        <div>
                          {notif.content && (
                            <p style={{ margin: '4px 0 2px', color: '#666', lineHeight: 1.5, fontSize: 13 }}>
                              {notif.content}
                            </p>
                          )}
                          <span style={{ fontSize: 11, color: '#bbb' }}>{formatTime(notif.created_at)}</span>
                        </div>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default Notifications;
