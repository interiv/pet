import React, { useEffect, useState, useRef } from 'react';
import { Card, List, Avatar, Button, Input, message, Space, Tag, Modal, Popconfirm, Empty, Spin, Tabs, Segmented } from 'antd';
import { LikeOutlined, LikeFilled, MessageOutlined, DeleteOutlined, SendOutlined, PlusOutlined, EditOutlined, PinFilled } from '@ant-design/icons';
import { postAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { TextArea } = Input;

const Posts: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();
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
        p.id === postId
          ? { ...p, like_count: res.data.like_count, is_liked: res.data.liked }
          : p
      ));
    } catch (e) {
      console.error('点赞失败');
    }
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
    <div key={comment.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Avatar size={28} src={comment.avatar} style={{ background: '#1890ff', fontSize: 12 }}>
          {comment.username?.[0]}
        </Avatar>
        <div style={{ flex: 1 }}>
          <Space size={4}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{comment.username}</span>
            {comment.parent_id && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>回复</Tag>}
          </Space>
          <p style={{ margin: '4px 0 0', color: '#333', lineHeight: 1.6, fontSize: 13 }}>{comment.content}</p>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontSize: 12 }}
            onClick={() => setReplyTo(prev => ({ ...prev, [postId]: comment.id }))}
          >
            回复
          </Button>

          {/* 子回复 */}
          {comment.parent_id && null}
        </div>
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 40 }}>
        <Empty description="登录后查看动态" />
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>📢 班级动态</h2>
        <Space>
          <Segmented
            options={[
              { label: '班级动态', value: 'class' },
              { label: '好友动态', value: 'friends' },
            ]}
            value={postType}
            onChange={(v) => setPostType(v as string)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
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
              <Card
                key={post.id}
                style={{ marginBottom: 16, borderRadius: 12 }}
                bodyStyle={{ padding: 16 }}
              >
                {/* 置顶标记 */}
                {post.is_top && (
                  <Tag color="red" icon={<PinFilled />} style={{ marginBottom: 8 }}>置顶</Tag>
                )}

                {/* 帖子头部 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Avatar src={post.avatar} style={{ background: '#1890ff' }}>{post.username?.[0]}</Avatar>
                  <div>
                    <Space>
                      <span style={{ fontWeight: 600 }}>{post.username}</span>
                      {post.role !== 'student' && <Tag color="blue">{post.role === 'teacher' ? '教师' : '管理员'}</Tag>}
                    </Space>
                    <div style={{ fontSize: 12, color: '#999' }}>{new Date(post.created_at).toLocaleString()}</div>
                  </div>
                </div>

                {/* 帖子内容 */}
                <p style={{ margin: '0 0 12px', fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {post.content}
                </p>

                {/* 图片 */}
                {post.images && (() => {
                  try {
                    const imgs = typeof post.images === 'string' ? JSON.parse(post.images) : post.images;
                    if (Array.isArray(imgs) && imgs.length > 0) {
                      return (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                          {imgs.map((img: string, idx: number) => (
                            <img key={idx} src={img} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover' }} />
                          ))}
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}

                {/* 操作栏 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f5f5f5', paddingTop: 10 }}>
                  <Space size={16}>
                    <Button
                      type="text"
                      icon={post.is_liked ? <LikeFilled style={{ color: '#1890ff' }} /> : <LikeOutlined />}
                      onClick={() => handleToggleLike(post.id)}
                    >
                      {post.like_count || 0}
                    </Button>
                    <Button type="text" icon={<MessageOutlined />}>
                      {(post.comment_count || 0)}
                    </Button>
                  </Space>
                  {(user?.id === post.user_id || user?.role === 'admin') && (
                    <Popconfirm title="确定删除此动态？" onConfirm={() => handleDeletePost(post.id)} okText="确定" cancelText="取消">
                      <Button type="text" danger size="small" icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  )}
                </div>

                {/* 评论区域 */}
                {(post.comment_count || 0) > 0 && (
                  <div style={{ marginTop: 12, background: '#fafafa', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>评论 ({post.comment_count})</div>
                    {post.recent_comments && post.recent_comments.map((c: any) => renderComment(c, post.id))}
                  </div>
                )}

                {/* 评论输入框 */}
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Input
                    placeholder={replyTo[post.id] ? "输入回复..." : "说点什么..."}
                    size="small"
                    value={commentInputs[post.id] || ''}
                    onChange={(e) => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                    onPressEnter={() => handleAddComment(post.id)}
                    style={{ flex: 1, borderRadius: 16 }}
                    suffix={
                      <SendOutlined
                        style={{ color: '#1890ff', cursor: 'pointer' }}
                        onClick={() => handleAddComment(post.id)}
                      />
                    }
                  />
                  {replyTo[post.id] && (
                    <Button size="small" type="link" onClick={() => setReplyTo(prev => ({ ...prev, [post.id]: 0 }))}>
                      取消回复
                    </Button>
                  )}
                </div>
              </Card>
            )}
          />
        )}
      </Spin>

      {/* 发布动态弹窗 */}
      <Modal
        title="发布动态"
        open={showCreateModal}
        onOk={handleCreatePost}
        onCancel={() => { setShowCreateModal(false); setNewContent(''); }}
        okText="发布"
        cancelText="取消"
      >
        <TextArea
          rows={4}
          placeholder="分享你的想法..."
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          maxLength={1000}
          showCount
          style={{ marginTop: 16 }}
        />
      </Modal>
    </div>
  );
};

export default Posts;
