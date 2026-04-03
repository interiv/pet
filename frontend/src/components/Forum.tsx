import React, { useEffect, useState } from 'react';
import { Card, List, Avatar, Button, Input, message, Space, Tag, Modal, Empty, Spin, Segmented, Popconfirm, Tooltip } from 'antd';
import { LikeOutlined, LikeFilled, MessageOutlined, DeleteOutlined, SendOutlined, PlusOutlined, StarOutlined, StarFilled, EyeOutlined, ClockCircleOutlined, SearchOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { forumAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { TextArea } = Input;

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

const Forum: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();
  const isMobile = useMobile();
  const [forums, setForums] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [activeForumId, setActiveForumId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);

  // 帖子详情
  const [viewingThread, setViewingThread] = useState<any>(null);
  const [showThreadDetail, setShowThreadDetail] = useState(false);

  // 发帖
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [selectedForumId, setSelectedForumId] = useState<number | null>(null);

  // 回复
  const [replyContent, setReplyContent] = useState('');
  const [replyToPostId, setReplyToPostId] = useState<number | undefined>();

  // 排序和搜索
  const [sortType, setSortType] = useState<string>('last_reply');
  const [searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    loadForums();
    loadThreads();
  }, []);

  useEffect(() => {
    if (activeForumId !== null) loadThreads();
  }, [activeForumId, sortType]);

  const loadForums = async () => {
    try {
      const res = await forumAPI.getForums();
      setForums(res.data.forums || []);
      if (!activeForumId && res.data.forums?.length > 0) {
        setActiveForumId(res.data.forums[0].id);
      }
    } catch (e) {
      console.error('加载论坛板块失败:', e);
    }
  };

  const loadThreads = async () => {
    setThreadsLoading(true);
    try {
      const params: any = { sort: sortType };
      if (activeForumId) params.forum_id = activeForumId;
      if (searchKeyword) params.keyword = searchKeyword;

      const res = await forumAPI.getThreads(params);
      setThreads(res.data.threads || []);
    } catch (e) {
      console.error('加载帖子列表失败:', e);
    } finally {
      setThreadsLoading(false);
    }
  };

  const handleCreateThread = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    if (!selectedForumId) return message.error('请选择板块');

    setLoading(true);
    try {
      await forumAPI.createThread({
        title: newTitle.trim(),
        content: newContent.trim(),
        forum_id: selectedForumId,
      });
      message.success('发布成功！');
      setShowCreateModal(false);
      setNewTitle('');
      setNewContent('');
      loadThreads();
    } catch (e: any) {
      message.error(e.response?.data?.error || '发布失败');
    } finally {
      setLoading(false);
    }
  };

  const openThreadDetail = async (thread: any) => {
    setThreadsLoading(true);
    try {
      const res = await forumAPI.getThreadDetail(thread.id);
      setViewingThread(res.data.thread);
      setShowThreadDetail(true);
    } catch (e) {
      console.error('加载帖子详情失败:', e);
    } finally {
      setThreadsLoading(false);
    }
  };

  const handleToggleLike = async (threadId: number) => {
    try {
      const res = await forumAPI.toggleThreadLike(threadId);
      if (viewingThread && viewingThread.id === threadId) {
        setViewingThread((prev: any) => ({ ...prev, like_count: res.data.like_count, is_liked: res.data.liked }));
      }
      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, like_count: res.data.like_count, is_liked: res.data.liked } : t
      ));
    } catch (e) {}
  };

  const handleToggleFavorite = async (threadId: number) => {
    try {
      const res = await forumAPI.toggleFavorite(threadId);
      if (viewingThread && viewingThread.id === threadId) {
        setViewingThread((prev: any) => ({ ...prev, is_favorited: res.data.favorited }));
      }
      message.success(res.data.favorited ? '已收藏' : '取消收藏');
    } catch (e) {}
  };

  const handleReply = async () => {
    if (!replyContent.trim() || !viewingThread) return;
    try {
      const data: any = { content: replyContent.trim() };
      if (replyToPostId) data.parent_id = replyToPostId;

      await forumAPI.replyThread(viewingThread.id, data);
      message.success('回复成功');
      setReplyContent('');
      setReplyToPostId(undefined);

      // 刷新帖子详情
      const detailRes = await forumAPI.getThreadDetail(viewingThread.id);
      setViewingThread(detailRes.data.thread);
    } catch (e: any) {
      message.error(e.response?.data?.error || '回复失败');
    }
  };

  const handleDeleteThread = async (threadId: number) => {
    try {
      await forumAPI.deleteThread(threadId);
      message.success('删除成功');
      setShowThreadDetail(false);
      setViewingThread(null);
      loadThreads();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 40 }}>
        <Empty description="登录后浏览论坛" />
      </Card>
    );
  }

  return (
    <div>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? 12 : 20, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : undefined }}>📋 班级论坛</h2>
        <Space size={isMobile ? 4 : 8} wrap>
          <Input.Search
            placeholder="搜索帖子..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onSearch={() => loadThreads()}
            enterButton={<SearchOutlined />}
            allowClear
            style={isMobile ? { width: 140 } : { width: 220 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setShowCreateModal(true); setSelectedForumId(activeForumId); }} size={isMobile ? 'small' : 'middle'}>
            发帖
          </Button>
        </Space>
      </div>

      <div style={{ display: isMobile ? 'block' : 'flex', gap: isMobile ? 12 : 16 }}>
        {/* 左侧 - 板块列表 */}
        <Card title="📁 板块" style={isMobile ? { width: '100%', marginBottom: 12 } : { width: 220, flexShrink: 0 }} styles={{ body: { padding: '8px 0' } }}>
          <List
            dataSource={forums}
            size="small"
            renderItem={(f: any) => (
              <div
                onClick={() => setActiveForumId(f.id)}
                style={{
                  padding: isMobile ? '8px 10px' : '10px 14px',
                  cursor: 'pointer',
                  background: activeForumId === f.id ? '#e6f7ff' : 'transparent',
                  borderLeft: `3px solid ${activeForumId === f.id ? '#1890ff' : 'transparent'}`,
                  transition: 'all 0.2s',
                }}
              >
                <Space size={isMobile ? 4 : 8}>
                  <span style={{ fontSize: isMobile ? 16 : undefined }}>{f.icon}</span>
                  <span style={{ fontWeight: activeForumId === f.id ? 600 : 400, fontSize: isMobile ? 13 : undefined }}>{f.name}</span>
                  <Tag style={{ fontSize: isMobile ? 9 : 10, marginLeft: 'auto' }}>{f.thread_count || 0}</Tag>
                </Space>
              </div>
            )}
          />
        </Card>

        {/* 右侧 - 帖子列表 / 详情 */}
        {!showThreadDetail ? (
          <Card style={isMobile ? { width: '100%' } : { flex: 1 }} styles={{ body: { padding: isMobile ? 8 : 12 } }}>
            {/* 排序栏 */}
            <Segmented
              options={[
                { label: '最新回复', value: 'last_reply' },
                { label: '最新发帖', value: 'new' },
                { label: '最热', value: 'hot' },
              ]}
              value={sortType}
              onChange={(v) => setSortType(v as string)}
              style={{ marginBottom: isMobile ? 12 : 16, width: isMobile ? '100%' : undefined }}
              block={isMobile}
            />

            <Spin spinning={threadsLoading}>
              {threads.length === 0 ? (
                <Empty description="暂无帖子" />
              ) : (
                <List
                  dataSource={threads}
                  renderItem={(thread: any) => (
                    <Card
                      key={thread.id}
                      size="small"
                      hoverable
                      style={{ marginBottom: isMobile ? 6 : 8, borderRadius: 8 }}
                      styles={{ body: { padding: isMobile ? 10 : 12 } }}
                      onClick={() => openThreadDetail(thread)}
                    >
                      <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'flex-start' }}>
                        <Avatar src={thread.avatar} size={isMobile ? 30 : 36} style={{ background: '#1890ff', flexShrink: 0 }}>
                          {thread.username?.[0]}
                        </Avatar>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: isMobile ? 13 : 14, cursor: 'pointer' }}>{thread.title}</span>
                            {thread.is_top && <Tag color="red" style={{ fontSize: isMobile ? 10 : undefined }}>置顶</Tag>}
                            {thread.is_essence && <Tag color="gold" style={{ fontSize: isMobile ? 10 : undefined }}>精华</Tag>}
                          </div>

                          {/* 标签 */}
                          {thread.tags && thread.tags.length > 0 && (
                            <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {thread.tags.map((tag: string, idx: number) => (
                                <Tag key={idx} color="blue" style={{ fontSize: isMobile ? 10 : 11, margin: 0 }}>{tag}</Tag>
                              ))}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: isMobile ? 8 : 16, alignItems: 'center', marginTop: 6, color: '#999', fontSize: isMobile ? 11 : 12, flexWrap: 'wrap' }}>
                            <span>{thread.username}</span>
                            <Space size={isMobile ? 8 : 12}>
                              <Tooltip title="浏览"><EyeOutlined /> {thread.view_count}</Tooltip>
                              <Tooltip title="回复"><MessageOutlined /> {(thread.reply_count || 0)}</Tooltip>
                              <Tooltip title="点赞">
                                <span
                                  style={{ cursor: 'pointer', color: thread.is_liked ? '#1890ff' : '' }}
                                  onClick={(e) => { e.stopPropagation(); handleToggleLike(thread.id); }}
                                >
                                  {thread.is_liked ? <LikeFilled /> : <LikeOutlined />} {thread.like_count || 0}
                                </span>
                              </Tooltip>
                              {!isMobile && <ClockCircleOutlined />}{formatTime(thread.last_reply_at || thread.created_at)}
                            </Space>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}
                />
              )}
            </Spin>
          </Card>
        ) : (
          /* 帖子详情 */
          <Card
            style={isMobile ? { width: '100%' } : { flex: 1 }}
            extra={
              <Button icon={<ArrowLeftOutlined />} onClick={() => { setShowThreadDetail(false); setViewingThread(null); }} size={isMobile ? 'small' : 'middle'}>
                {isMobile ? '' : '← 返回列表'}
              </Button>
            }
          >
            {viewingThread && (
              <>
                {/* 标题区 */}
                <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: isMobile ? 12 : 16, marginBottom: isMobile ? 12 : 16 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    {viewingThread.is_top && <Tag color="red" style={{ fontSize: isMobile ? 10 : undefined }}>置顶</Tag>}
                    {viewingThread.is_essence && <Tag color="gold" style={{ fontSize: isMobile ? 10 : undefined }}>精华</Tag>}
                    {viewingThread.tags && viewingThread.tags.map((tag: string, idx: number) => (
                      <Tag key={idx} color="blue" style={{ fontSize: isMobile ? 10 : undefined }}>{tag}</Tag>
                    ))}
                  </div>
                  <h2 style={{ margin: 0, fontSize: isMobile ? 18 : undefined }}>{viewingThread.title}</h2>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: '#999', fontSize: isMobile ? 12 : 13, flexWrap: 'wrap', gap: 4 }}>
                    <Space size={isMobile ? 4 : 8} wrap>
                      <Avatar size={isMobile ? 20 : 24} src={viewingThread.avatar} style={{ background: '#1890ff' }}>
                        {viewingThread.username?.[0]}
                      </Avatar>
                      <span>{viewingThread.username}</span>
                      {!isMobile && <span>·</span>}
                      <span>{formatTime(viewingThread.created_at)}</span>
                    </Space>
                    <Space size={isMobile ? 6 : 12}>
                      <EyeOutlined /> {viewingThread.view_count}
                      <LikeOutlined /> {viewingThread.like_count}
                      <MessageOutlined /> {viewingThread.reply_count}
                    </Space>
                  </div>

                  {/* 操作按钮 */}
                  <div style={{ marginTop: isMobile ? 10 : 12, display: 'flex', gap: isMobile ? 4 : 8, flexWrap: 'wrap' }}>
                    <Button
                      icon={viewingThread.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
                      onClick={() => handleToggleLike(viewingThread.id)}
                      size={isMobile ? 'small' : 'middle'}
                    >
                      {viewingThread.is_liked ? '已赞' : '点赞'}
                    </Button>
                    <Button
                      icon={viewingThread.is_favorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                      onClick={() => handleToggleFavorite(viewingThread.id)}
                      size={isMobile ? 'small' : 'middle'}
                    >
                      {viewingThread.is_favorited ? '已收藏' : '收藏'}
                    </Button>
                    {(user?.id === viewingThread.user_id || user?.role === 'admin') && (
                      <Popconfirm title="确定删除此帖子？" onConfirm={() => handleDeleteThread(viewingThread.id)} okText="确定" cancelText="取消">
                        <Button danger icon={<DeleteOutlined />} size={isMobile ? 'small' : 'middle'}>删除</Button>
                      </Popconfirm>
                    )}
                  </div>
                </div>

                {/* 主楼内容 */}
                <div style={{ background: '#fafafa', borderRadius: 8, padding: isMobile ? 12 : 16, marginBottom: isMobile ? 14 : 20 }}>
                  <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0, fontSize: isMobile ? 14 : undefined }}>{viewingThread.content}</p>
                </div>

                {/* 回复列表 */}
                <h3 style={{ margin: `0 0 ${isMobile ? 10 : 12}px`, fontSize: isMobile ? 15 : undefined }}>💬 回复 ({(viewingThread.reply_count || 0)})</h3>
                <Spin spinning={threadsLoading}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 12, maxHeight: isMobile ? 300 : 400, overflowY: 'auto', paddingRight: 4 }}>
                    {(!viewingThread.replies || viewingThread.replies.length === 0) ? (
                      <Empty description="暂无回复，抢沙发！" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      viewingThread.replies.map((post: any) => (
                        <Card key={post.id} size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: isMobile ? 10 : undefined } }}>
                          <div style={{ display: 'flex', gap: isMobile ? 8 : 10, alignItems: 'flex-start' }}>
                            <Avatar src={post.avatar} size={isMobile ? 28 : 32} style={{ background: '#1890ff', flexShrink: 0 }}>
                              {post.username?.[0]}
                            </Avatar>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Space size={isMobile ? 4 : 6}>
                                <span style={{ fontWeight: 600, fontSize: isMobile ? 12 : 13 }}>{post.username}</span>
                                {post.is_first_post && <Tag color="green" style={{ fontSize: isMobile ? 9 : 10 }}>楼主</Tag>}
                                <span style={{ fontSize: isMobile ? 10 : 11, color: '#bbb' }}>{formatTime(post.created_at)}</span>
                              </Space>
                              <p style={{ margin: `${isMobile ? 4 : 6}px 0 0`, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontSize: isMobile ? 13 : undefined }}>{post.content}</p>
                              <div style={{ marginTop: 6, display: 'flex', gap: isMobile ? 4 : 8 }}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={post.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
                                  onClick={async () => {
                                    try {
                                      const res = await forumAPI.togglePostLike(post.id);
                                      const updated = viewingThread.replies.map((reply: any) =>
                                        reply.id === post.id ? { ...reply, like_count: res.data.like_count, is_liked: res.data.liked } : reply
                                      );
                                      setViewingThread((prev: any) => ({ ...prev, replies: updated }));
                                    } catch {}
                                  }}
                                >
                                  {post.like_count || 0}
                                </Button>
                                <Button
                                  type="text"
                                  size="small"
                                  onClick={() => { setReplyToPostId(post.id); setReplyContent(`@${post.username} `); }}
                                >
                                  回复
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                </Spin>

                {/* 回复输入框 */}
                <div style={{ marginTop: isMobile ? 12 : 16, borderTop: '1px solid #f0f0f0', paddingTop: isMobile ? 12 : 16 }}>
                  {replyToPostId && (
                    <Tag closable onClose={() => setReplyToPostId(undefined)} style={{ marginBottom: 8, fontSize: isMobile ? 11 : undefined }}>
                      回复 #{replyToPostId}
                    </Tag>
                  )}
                  <TextArea
                    rows={isMobile ? 3 : 3}
                    placeholder="写下你的回复..."
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    maxLength={2000}
                    showCount
                    style={{ fontSize: isMobile ? 14 : undefined }}
                  />
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <Button type="primary" icon={<SendOutlined />} onClick={handleReply} disabled={!replyContent.trim()} size={isMobile ? 'small' : 'middle'}>
                      发布回复
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      {/* 发帖弹窗 */}
      <Modal
        title="发表新帖"
        open={showCreateModal}
        onOk={handleCreateThread}
        onCancel={() => { setShowCreateModal(false); setNewTitle(''); setNewContent(''); }}
        okText="发布"
        confirmLoading={loading}
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>选择板块：</label>
          <select
            value={selectedForumId || ''}
            onChange={(e) => setSelectedForumId(parseInt(e.target.value))}
            style={{ width: '100%', padding: '6px 11px', borderRadius: 6, border: '1px solid #d9d9d9' }}
          >
            <option value="">请选择板块</option>
            {forums.map(f => (
              <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
            ))}
          </select>
        </div>
        <Input
          placeholder="帖子标题"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          maxLength={100}
          showCount
          style={{ marginBottom: 12 }}
        />
        <TextArea
          rows={5}
          placeholder="详细描述你的问题或想法..."
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          maxLength={5000}
          showCount
        />
      </Modal>
    </div>
  );
};

export default Forum;
