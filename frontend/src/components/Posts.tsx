import React, { useEffect, useState } from 'react';
import { Card, List, Avatar, Button, Input, message, Space, Tag, Modal, Popconfirm, Empty, Spin, Segmented } from 'antd';
import { LikeOutlined, LikeFilled, MessageOutlined, DeleteOutlined, SendOutlined, PlusOutlined } from '@ant-design/icons';
import { postAPI } from '../utils/api';
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

const Posts: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();
  const isMobile = useMobile();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [postType, setPostType] = useState<string>('class');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [replyTo, setReplyTo] = useState<Record<number, number>>({});

  useEffect(() => {
    if (isAuthenticated) loadPosts();
  }, [isAuthenticated, postType]);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const res = await postAPI.getPosts({ type: postType });
      setPosts(res.data.posts || []);
    } catch (e) {
      console.error('加载动态失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePost = async () => {
    if (!newContent.trim()) return;
    try {
      await postAPI.createPost({ content: newContent, scope: postType === 'class' ? 'class' : 'public' });
      message.success('发布成功！');
      setNewContent('');
      setShowCreateModal(false);
      loadPosts();
    } catch (e: any) {
      message.error(e.response?.data?.error || '发布失败');
    }
  };

  const handleToggleLike = async (postId: number) => {
    try {
      const res = await postAPI.toggleLike(postId);
      setPosts(prev => prev.map(p =>
        p.id === postId ? { ...p, like_count: res.data.like_count, is_liked: res.data.liked } : p
      ));
    } catch (e) {}
  };

  const handleAddComment = async (postId: number) => {
    const content = commentInputs[postId];
    if (!content || !content.trim()) return;
    try {
      const parentId = replyTo[postId] || undefined;
      await postAPI.addComment(postId, { content: content.trim(), parent_id: parentId });
      message.success('评论成功');
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
      setReplyTo(prev => ({ ...prev, [postId]: 0 }));
      loadPosts();
    } catch (e: any) {
      message.error(e.response?.data?.error || '评论失败');
    }
  };

  const handleDeletePost = async (postId: number) => {
    try {
      await postAPI.deletePost(postId);
      message.success('删除成功');
      loadPosts();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const renderComment = (comment: any, postId: number) => (
    <div key={comment.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Avatar size={isMobile ? 24 : 28} src={comment.avatar} style={{ background: '#1890ff', fontSize: isMobile ? 10 : 12, flexShrink: 0 }}>
          {comment.username?.[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={4} wrap>
            <span style={{ fontWeight: 600, fontSize: isMobile ? 12 : 13 }}>{comment.username}</span>
            {comment.parent_id && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>回复</Tag>}
          </Space>
          <p style={{ margin: '2px 0 0', color: '#333', lineHeight: 1.5, fontSize: isMobile ? 12 : 13, wordBreak: 'break-word' }}>{comment.content}</p>
          <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 11 }} onClick={() => setReplyTo(prev => ({ ...prev, [postId]: comment.id }))}>
            回复
          </Button>
        </div>
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: isMobile ? 20 : 40 }}>
        <Empty description="登录后查看动态" />
      </Card>
    );
  }

  return (
    <div>
      {/* 头部 - 手机端换行 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        marginBottom: isMobile ? 14 : 20,
        gap: isMobile ? 8 : 0,
        flexDirection: isMobile ? 'column' : 'row',
      }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : undefined }}>📢 班级动态</h2>
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size={isMobile ? 4 : 8} style={{ width: isMobile ? '100%' : 'auto' }}>
          <Segmented
            options={[
              { label: '班级动态', value: 'class' },
              { label: '好友动态', value: 'friends' },
            ]}
            value={postType}
            onChange={(v) => setPostType(v as string)}
            block={isMobile}
            size={isMobile ? 'small' : 'middle'}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)} block={isMobile}>
            发布动态
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {posts.length === 0 && !loading ? (
          <Empty description="暂无动态，快来发第一条吧！" />
        ) : (
          <List
            dataSource={posts}
            renderItem={(post: any) => (
              <Card key={post.id} style={{ marginBottom: isMobile ? 10 : 16, borderRadius: 12 }} styles={{ body: { padding: isMobile ? 12 : 16 } }}>
                {post.is_top && <Tag color="red" style={{ marginBottom: 6 }}>置顶</Tag>}

                {/* 帖子头部 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Avatar src={post.avatar} size={isMobile ? 32 : undefined} style={{ background: '#1890ff', flexShrink: 0 }}>{post.username?.[0]}</Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={4} wrap>
                      <span style={{ fontWeight: 600, fontSize: isMobile ? 13 : undefined }}>{post.username}</span>
                      {post.role !== 'student' && <Tag color="blue" style={{ fontSize: 10 }}>{post.role === 'teacher' ? '教师' : '管理员'}</Tag>}
                    </Space>
                    <div style={{ fontSize: isMobile ? 11 : 12, color: '#999' }}>{new Date(post.created_at).toLocaleString()}</div>
                  </div>
                </div>

                {/* 帖子内容 */}
                <p style={{ margin: '0 0 10px', fontSize: isMobile ? 14 : 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {post.content}
                </p>

                {/* 图片 */}
                {post.images && (() => {
                  try {
                    const imgs = typeof post.images === 'string' ? JSON.parse(post.images) : post.images;
                    if (Array.isArray(imgs) && imgs.length > 0) {
                      return (
                        <div style={{
                          display: 'grid',
                          gap: 6,
                          marginBottom: 10,
                          gridTemplateColumns: imgs.length === 1 ? '1fr' : imgs.length === 2 ? '1fr 1fr' : isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
                        }}>
                          {imgs.map((img: string, idx: number) => (
                            <img key={idx} src={img} alt="" style={{ width: '100%', maxHeight: isMobile ? 120 : 150, borderRadius: 8, objectFit: 'cover' }} />
                          ))}
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}

                {/* 操作栏 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid #f5f5f5',
                  paddingTop: 8,
                  gap: 4,
                }}>
                  <Space size={isMobile ? 8 : 16}>
                    <Button type="text" size={isMobile ? 'small' : 'middle'} icon={post.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />} onClick={() => handleToggleLike(post.id)}>
                      {post.like_count || 0}
                    </Button>
                    <Button type="text" size={isMobile ? 'small' : 'middle'} icon={<MessageOutlined />}>{(post.comment_count || 0)}</Button>
                  </Space>
                  {(user?.id === post.user_id || user?.role === 'admin') && (
                    <Popconfirm title="确定删除此动态？" onConfirm={() => handleDeletePost(post.id)} okText="确定" cancelText="取消">
                      <Button type="text" danger size="small" icon={<DeleteOutlined />}>{isMobile ? '' : '删除'}</Button>
                    </Popconfirm>
                  )}
                </div>

                {/* 评论区域 */}
                {(post.comment_count || 0) > 0 && (
                  <div style={{ marginTop: 10, background: '#fafafa', borderRadius: 8, padding: isMobile ? 8 : 12 }}>
                    <div style={{ fontWeight: 500, marginBottom: 6, fontSize: isMobile ? 12 : 13 }}>评论 ({post.comment_count})</div>
                    {post.recent_comments && post.recent_comments.map((c: any) => renderComment(c, post.id))}
                  </div>
                )}

                {/* 评论输入框 */}
                <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Input
                    placeholder={replyTo[post.id] ? "输入回复..." : "说点什么..."}
                    size="small"
                    value={commentInputs[post.id] || ''}
                    onChange={(e) => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                    onPressEnter={() => handleAddComment(post.id)}
                    style={{ flex: 1, borderRadius: 16 }}
                    suffix={<SendOutlined style={{ color: '#1890ff', cursor: 'pointer' }} onClick={() => handleAddComment(post.id)} />}
                  />
                  {replyTo[post.id] && (
                    <Button size="small" type="link" onClick={() => setReplyTo(prev => ({ ...prev, [post.id]: 0 }))} style={{ flexShrink: 0 }}>
                          取消
                        </Button>
                  )}
                </div>
              </Card>
            )}
          />
        )}
      </Spin>

      {/* 发布动态弹窗 */}
      <Modal title="发布动态" open={showCreateModal} onOk={handleCreatePost} onCancel={() => { setShowCreateModal(false); setNewContent(''); }} okText="发布" cancelText="取消" centered>
        <TextArea rows={isMobile ? 3 : 4} placeholder="分享你的想法..." value={newContent} onChange={(e) => setNewContent(e.target.value)} maxLength={1000} showCount style={{ marginTop: 16 }} />
      </Modal>
    </div>
  );
};

export default Posts;
