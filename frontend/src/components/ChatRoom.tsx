import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Card, List, Avatar, Button, Input, message, Space, Tag, Empty, Spin, Tabs, Modal, Badge } from 'antd';
import { SendOutlined, SearchOutlined, TeamOutlined, UserOutlined, SmileOutlined, PlusOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import { chatAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { TextArea } = Input;

interface Message {
  id: number;
  user_id: number;
  username: string;
  avatar: string | null;
  content: string;
  msg_type: string;
  room_type: string;
  created_at: string;
}

interface Conversation {
  id?: number | string;
  type: 'class' | 'private';
  name: string;
  avatar?: string;
  last_message?: string;
  last_time?: string;
  unread_count?: number;
  target_user_id?: number;
  class_id?: number;
}

const ChatRoom: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChat, setActiveChat] = useState<Conversation | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  useEffect(() => {
    if (isAuthenticated) initSocket();
    return () => {
      socketRef.current?.disconnect();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) loadConversations();
  }, [isAuthenticated]);

  const initSocket = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || !user?.id) return;

    const socket = io((window as any).__VITE_API_URL__?.replace('/api', '') || 'http://localhost:3000', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('聊天 Socket 已连接');
    });

    // 班级群聊消息
    socket.on('new-class-message', (msg: Message) => {
      if (activeChat && activeChat.type === 'class') {
        setMessages(prev => [...prev, msg]);
        scrollToBottom();
      }
    });

    // 私聊消息
    socket.on('new-private-message', (msg: Message) => {
      if (activeChat && activeChat.type === 'private') {
        setMessages(prev => [...prev, msg]);
        scrollToBottom();
      }
    });

    // 正在输入提示
    socket.on('user-typing', (data: { username: string }) => {
      setTypingUsers(prev => {
        if (!prev.includes(data.username)) return [...prev, data.username];
        return prev;
      });
      clearTimeout(typingTimerRef.current!);
      typingTimerRef.current = setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => u !== data.username));
      }, 3000);
    });

    socketRef.current = socket;
  }, [user]);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const res = await chatAPI.getConversations();
      setConversations(res.data.conversations || []);
    } catch (e) {
      console.error('加载聊天列表失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conv: Conversation) => {
    setActiveChat(conv);
    setMessagesLoading(true);
    try {
      const params: any = { room_type: conv.type };
      if (conv.type === 'class') {
        params.room_id = conv.class_id;
        socketRef.current?.emit('join-class-chat', conv.class_id);
      } else if (conv.type === 'private' && conv.target_user_id) {
        params.target_user_id = conv.target_user_id;
        socketRef.current?.emit('join-private-chat', { userId1: user!.id, userId2: conv.target_user_id });
      }

      const res = await chatAPI.getMessages(params);
      setMessages(res.data.messages || []);
      scrollToBottom();
    } catch (e) {
      console.error('加载消息失败:', e);
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !activeChat || !user) return;

    const content = inputValue.trim();

    try {
      const data: any = {
        content,
        room_type: activeChat.type,
      };

      if (activeChat.type === 'class') {
        data.room_id = activeChat.class_id;
      } else if (activeChat.type === 'private' && activeChat.target_user_id) {
        data.target_user_id = activeChat.target_user_id;
      }

      const res = await chatAPI.sendMessage(data);

      // 实时广播
      if (activeChat.type === 'class') {
        socketRef.current?.emit('send-class-message', {
          classId: activeChat.class_id,
          message: res.data.message,
        });
      } else {
        socketRef.current?.emit('send-private-message', {
          targetUserId: activeChat.target_user_id,
          message: res.data.message,
        });
      }

      setInputValue('');
      setMessages(prev => [...prev, res.data.message]);
      scrollToBottom();
      loadConversations(); // 更新最后消息时间
    } catch (e: any) {
      message.error(e.response?.data?.error || '发送失败');
    }
  };

  const handleSearchUser = async () => {
    if (!searchKeyword.trim()) return;
    try {
      const res = await chatAPI.searchUsers(searchKeyword.trim());
      setSearchResults(res.data.users || []);
    } catch (e) {
      console.error('搜索用户失败:', e);
    }
  };

  const startPrivateChat = (targetUser: any) => {
    const existingConv = conversations.find(
      c => c.type === 'private' && c.target_user_id === targetUser.id
    );
    if (existingConv) {
      loadMessages(existingConv);
    } else {
      const newConv: Conversation = {
        type: 'private',
        name: targetUser.username,
        avatar: targetUser.avatar,
        target_user_id: targetUser.id,
      };
      loadMessages(newConv);
    }
    setShowSearchModal(false);
    setSearchKeyword('');
    setSearchResults([]);
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 40 }}>
        <Empty description="登录后使用聊天功能" />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 200px)', minHeight: 500 }}>
      {/* 左侧 - 聊天列表 */}
      <Card
        title={
          <Space>
            <span>💬 消息</span>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setShowSearchModal(true)}>
              发起私聊
            </Button>
          </Space>
        }
        style={{ width: 280, borderRadius: '12px 0 0 12px', borderRight: 0 }}
        bodyStyle={{ padding: 0, overflowY: 'auto', height: 'calc(100% - 57px)' }}
      >
        <Spin spinning={loading}>
          <List
            dataSource={conversations}
            renderItem={(conv: Conversation) => (
              <div
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: activeChat?.id === conv.id ? '#e6f7ff' : 'transparent',
                  borderBottom: '1px solid #f5f5f5',
                  transition: 'background 0.2s',
                }}
                onClick={() => loadMessages(conv)}
                onMouseEnter={(e) => { if ((e.currentTarget as HTMLElement).style.background !== '#e6f7ff') (e.currentTarget as HTMLElement).style.background = '#fafafa'; }}
                onMouseLeave={(e) => { if ((e.currentTarget as HTMLElement).style.background !== '#e6f7ff') (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Badge count={conv.unread_count || 0} size="small" offset={[-4, 4]}>
                    <Avatar
                      src={conv.avatar}
                      style={{
                        background: conv.type === 'class' ? '#52c41a' : '#1890ff',
                        fontSize: 14,
                      }}
                    >
                      {conv.type === 'class' ? <TeamOutlined /> : (conv.name?.[0])}
                    </Avatar>
                  </Badge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{conv.name}</span>
                      <span style={{ fontSize: 11, color: '#999' }}>{formatTime(conv.last_time || '')}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.last_message || '暂无消息'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          />
        </Spin>
      </Card>

      {/* 右侧 - 聊天区域 */}
      <Card
        title={activeChat ? (
          <Space>
            <Tag color={activeChat.type === 'class' ? 'green' : 'blue'} icon={activeChat.type === 'class' ? <TeamOutlined /> : <UserOutlined />}>
              {activeChat.type === 'class' ? '群聊' : '私聊'}
            </Tag>
            <span>{activeChat.name}</span>
          </Space>
        ) : '选择一个对话开始聊天'}
        style={{ flex: 1, borderRadius: '0 12px 12px 0' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 57px)' }}
      >
        {!activeChat ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="选择左侧的对话开始聊天" />
          </div>
        ) : (
          <>
            {/* 消息列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Spin spinning={messagesLoading}>
                {messages.length === 0 ? (
                  <Empty description="暂无消息，发送第一条吧" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: msg.user_id === user!.id ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '65%',
                          display: 'flex',
                          gap: 8,
                          alignItems: 'flex-start',
                          flexDirection: msg.user_id === user!.id ? 'row-reverse' : 'row',
                        }}
                      >
                        {msg.user_id !== user!.id && (
                          <Avatar size={32} src={msg.avatar} style={{ background: '#1890ff', fontSize: 13, flexShrink: 0 }}>
                            {msg.username?.[0]}
                          </Avatar>
                        )}
                        <div>
                          {msg.user_id !== user!.id && (
                            <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>{msg.username}</span>
                          )}
                          <div
                            style={{
                              marginTop: 4,
                              padding: '8px 14px',
                              borderRadius: msg.user_id === user!.id ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                              background: msg.user_id === user!.id ? '#1890ff' : '#f0f0f0',
                              color: msg.user_id === user!.id ? '#fff' : '#333',
                              wordBreak: 'break-word',
                              lineHeight: 1.6,
                            }}
                          >
                            {msg.content}
                          </div>
                          <span style={{ fontSize: 10, color: '#bbb', marginLeft: 8, display: 'block', marginTop: 2 }}>
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                        {msg.user_id === user!.id && (
                          <Avatar size={32} src={user!.avatar} style={{ background: '#52c41a', fontSize: 13, flexShrink: 0 }}>
                            {user!.username?.[0]}
                          </Avatar>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* 输入中提示 */}
                {typingUsers.length > 0 && (
                  <div style={{ textAlign: 'center', fontSize: 12, color: '#999' }}>
                    {typingUsers.join(', ')} 正在输入...
                  </div>
                )}
              </Spin>
              <div ref={messagesEndRef} />
            </div>

            {/* 输入框 */}
            <div style={{ borderTop: '1px solid #f0f0f0', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <TextArea
                rows={1}
                placeholder={`发送到 ${activeChat.name}...`}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{ borderRadius: 8, resize: 'none' }}
              />
              <Button
                type="primary"
                shape="circle"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!inputValue.trim()}
                style={{ marginBottom: 4 }}
              />
            </div>
          </>
        )}
      </Card>

      {/* 搜索用户弹窗 */}
      <Modal
        title="搜索用户发起私聊"
        open={showSearchModal}
        onCancel={() => { setShowSearchModal(false); setSearchResults([]); }}
        footer={null}
      >
        <Input.Search
          placeholder="输入用户名搜索..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onSearch={handleSearchUser}
          enterButton={<SearchOutlined />}
          style={{ marginBottom: 16 }}
        />
        <List
          dataSource={searchResults}
          renderItem={(u: any) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => startPrivateChat(u)}
            >
              <List.Item.Meta
                avatar={<Avatar src={u.avatar}>{u.username?.[0]}</Avatar>}
                title={u.username}
                description={`${u.role === 'teacher' ? '教师' : '学生'} · ${u.class_name || ''}`}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default ChatRoom;
