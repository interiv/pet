const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== 动态/留言板 ====================

// 获取动态列表（支持班级筛选、好友动态）
router.get('/posts', authenticateToken, (req, res) => {
  try {
    const { type, class_id, page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT p.*, u.username, u.avatar, u.role,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comment_count,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
    `;
    const params = [userId];

    if (type === 'class' && class_id) {
      sql += ` WHERE p.class_id = ?`;
      params.push(parseInt(class_id));
    } else if (type === 'friends') {
      sql += ` WHERE p.user_id IN (
        SELECT friend_id FROM friends WHERE user_id = ?
        UNION SELECT ?
      )`;
      params.push(userId, userId);
    } else {
      // 全校动态（按班级优先，然后全校）
      const userClassId = db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId);
      if (userClassId && userClassId.class_id) {
        sql += ` WHERE (p.class_id = ? OR p.scope = 'public')`;
        params.push(userClassId.class_id);
      } else {
        sql += ` WHERE p.scope = 'public'`;
      }
    }

    sql += ` ORDER BY p.is_top DESC, p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const posts = db.prepare(sql).all(...params);

    // 获取每条帖子的最新几条评论
    const postsWithComments = posts.map(post => {
      const comments = db.prepare(`
        SELECT c.*, u.username, u.avatar
        FROM post_comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC
        LIMIT 5
      `).all(post.id);
      return { ...post, recent_comments: comments };
    });

    res.json({ posts: postsWithComments });
  } catch (error) {
    console.error('获取动态列表失败:', error);
    res.status(500).json({ error: '获取动态列表失败' });
  }
});

// 发布动态
router.post('/posts', authenticateToken, (req, res) => {
  try {
    const { content, images, scope = 'class', class_id } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '内容不能为空' });
    }

    const userId = req.user.userId;
    const targetClassId = class_id || db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId)?.class_id;

    // 校验：非管理员不能跨班发帖
    if (targetClassId && req.user.role !== 'admin') {
      const asStudent = db.prepare('SELECT 1 FROM users WHERE id = ? AND class_id = ?').get(userId, targetClassId);
      const asTeacher = db.prepare('SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?').get(userId, targetClassId);
      if (!asStudent && !asTeacher) {
        return res.status(403).json({ error: '无权在该班级发布动态' });
      }
    }

    const result = db.prepare(`
      INSERT INTO posts (user_id, content, images, scope, class_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, content.trim(), images ? JSON.stringify(images) : null, scope, targetClassId);

    const newPost = db.prepare(`
      SELECT p.*, u.username, u.avatar
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ message: '发布成功', post: newPost });
  } catch (error) {
    console.error('发布动态失败:', error);
    res.status(500).json({ error: '发布动态失败' });
  }
});

// 删除动态
router.delete('/posts/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);

    if (!post) return res.status(404).json({ error: '动态不存在' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && post.user_id !== req.user.userId) {
      return res.status(403).json({ error: '只能删除自己的动态' });
    }

    db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(id);
    db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(id);
    db.prepare("DELETE FROM notifications WHERE source_type = 'post' AND source_id = ?").run(id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除动态失败:', error);
    res.status(500).json({ error: '删除动态失败' });
  }
});

// 点赞/取消点赞
router.post('/posts/:id/like', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const existingLike = db.prepare('SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?').get(id, userId);

    if (existingLike) {
      db.prepare('DELETE FROM post_likes WHERE id = ?').run(existingLike.id);
      db.prepare("UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").run(id);
      res.json({ liked: false, like_count: Math.max(0, (post.like_count || 0) - 1) });
    } else {
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(id, userId);
      db.prepare("UPDATE posts SET like_count = COALESCE(like_count, 0) + 1 WHERE id = ?").run(id);

      // 如果不是自己给自己点赞，发送通知
      if (post.user_id !== userId) {
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'like', '收到新的点赞', ?, 'post', ?)
        `).run(post.user_id, `${user.username} 赞了你的动态`, id);
      }

      res.json({ liked: true, like_count: (post.like_count || 0) + 1 });
    }
  } catch (error) {
    console.error('点赞操作失败:', error);
    res.status(500).json({ error: '点赞操作失败' });
  }
});

// 评论
router.post('/posts/:id/comments', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { content, parent_id } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '评论内容不能为空' });
    }

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const result = db.prepare(`
      INSERT INTO post_comments (post_id, user_id, content, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(id, req.user.userId, content.trim(), parent_id || null);

    db.prepare("UPDATE posts SET comment_count = COALESCE(comment_count, 0) + 1 WHERE id = ?").run(id);

    // 发送评论通知给帖子作者（如果评论者不是作者本人）
    if (post.user_id !== req.user.userId) {
      const commenter = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'comment', '收到新评论', ?, 'post', ?)
      `).run(post.user_id, `${commenter.username} 评论了你的动态`, id);
    }

    // 如果是回复评论，也通知被回复的人
    if (parent_id) {
      const parentComment = db.prepare('SELECT user_id FROM post_comments WHERE id = ?').get(parent_id);
      if (parentComment && parentComment.user_id !== req.user.userId && parentComment.user_id !== post.user_id) {
        const commenter = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'reply', '有人回复了你', ?, 'comment', ?)
        `).run(parentComment.user_id, `${commenter.username} 回复了你的评论`, parent_id);
      }
    }

    const comment = db.prepare(`
      SELECT c.*, u.username, u.avatar
      FROM post_comments c JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ message: '评论成功', comment });
  } catch (error) {
    console.error('评论失败:', error);
    res.status(500).json({ error: '评论失败' });
  }
});

// 删除评论
router.delete('/comments/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const comment = db.prepare('SELECT * FROM post_comments WHERE id = ?').get(id);

    if (!comment) return res.status(404).json({ error: '评论不存在' });

    const isAdmin = req.user.role === 'admin';
    const isOwner = comment.user_id === req.user.userId;
    const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(comment.post_id);
    const isPostOwner = post && post.user_id === req.user.userId;

    if (!isAdmin && !isOwner && !isPostOwner) {
      return res.status(403).json({ error: '无权删除此评论' });
    }

    // 如果有子评论，一并删除
    const childCount = db.prepare('SELECT COUNT(*) as cnt FROM post_comments WHERE parent_id = ?').get(id).cnt;
    if (childCount > 0) {
      db.prepare('DELETE FROM post_comments WHERE parent_id = ?').run(id);
    }

    db.prepare('DELETE FROM post_comments WHERE id = ?').run(id);
    const totalDeleted = 1 + childCount;
    db.prepare("UPDATE posts SET comment_count = MAX(0, COALESCE(comment_count, 0) - ?) WHERE id = ?").run(totalDeleted, comment.post_id);

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(500).json({ error: '删除评论失败' });
  }
});

// 置顶/取消置顶（管理员或班主任）
router.put('/posts/:id/pin', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { is_top } = req.body;

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const userId = req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin) {
      // 检查是否是班主任
      const isHeadTeacher = db.prepare(`
        SELECT id FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'
      `).get(userId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有管理员或班主任才能置顶' });
      }
    }

    db.prepare('UPDATE posts SET is_top = ? WHERE id = ?').run(is_top ? 1 : 0, id);
    res.json({ message: is_top ? '已置顶' : '已取消置顶' });
  } catch (error) {
    console.error('置顶操作失败:', error);
    res.status(500).json({ error: '置顶操作失败' });
  }
});

module.exports = router;
