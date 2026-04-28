const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== 论坛系统 ====================

// 获取论坛板块列表
router.get('/forums', authenticateToken, (req, res) => {
  try {
    const forums = db.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM forum_threads WHERE forum_id = f.id AND status != 'deleted') as thread_count,
        (SELECT COUNT(*) FROM forum_posts WHERE forum_id = f.id AND status = 'active') as post_count,
        (SELECT MAX(fp.created_at) FROM forum_posts fp JOIN forum_threads ft ON fp.thread_id = ft.id
          WHERE ft.forum_id = f.id AND ft.status != 'deleted') as last_activity
      FROM forums f
      ORDER BY sort_order ASC, id ASC
    `).all();

    res.json({ forums });
  } catch (error) {
    console.error('获取论坛列表失败:', error);
    res.status(500).json({ error: '获取论坛列表失败' });
  }
});

// 获取帖子列表（支持板块筛选、搜索、班级过滤）
router.get('/threads', authenticateToken, (req, res) => {
  try {
    const { forum_id, page = 1, limit = 20, keyword, sort = 'last_reply', class_id, scope } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT t.*, u.username, u.avatar,
        (SELECT COUNT(*) FROM forum_posts WHERE thread_id = t.id AND status = 'active') as reply_count,
        (SELECT username FROM users WHERE id = t.last_reply_user_id) as last_reply_username
      FROM forum_threads t
      JOIN users u ON t.user_id = u.id
      WHERE t.status != 'deleted'
    `;
    const params = [];

    if (forum_id) {
      sql += ` AND t.forum_id = ?`;
      params.push(parseInt(forum_id));
    }

    // 班级过滤：
    //  scope='public'：仅全站贴（class_id IS NULL）
    //  scope='class'：仅本班贴（需 class_id）
    //  默认：本班贴 + 全站贴
    if (scope === 'public') {
      sql += ` AND t.class_id IS NULL`;
    } else if (class_id) {
      const cid = parseInt(class_id, 10);
      if (scope === 'class') {
        sql += ` AND t.class_id = ?`;
        params.push(cid);
      } else {
        sql += ` AND (t.class_id = ? OR t.class_id IS NULL)`;
        params.push(cid);
      }
    }

    if (keyword) {
      sql += ` AND (t.title LIKE ? OR t.content LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (sort === 'hot') {
      sql += ` ORDER BY (t.view_count + t.reply_count * 3 + t.like_count * 5) DESC`;
    } else if (sort === 'new') {
      sql += ` ORDER BY t.created_at DESC`;
    } else {
      sql += ` ORDER BY COALESCE(t.last_reply_at, t.created_at) DESC`;
    }

    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const threads = db.prepare(sql).all(...params);

    // 获取每个帖子的标签
    const threadsWithTags = threads.map(thread => {
      const tags = db.prepare(`SELECT tag_name FROM forum_thread_tags WHERE thread_id = ?`).all(thread.id);
      return { ...thread, tags: tags.map(t => t.tag_name) };
    });

    res.json({ threads: threadsWithTags });
  } catch (error) {
    console.error('获取帖子列表失败:', error);
    res.status(500).json({ error: '获取帖子列表失败' });
  }
});

// 获取帖子详情（含回复）
router.get('/threads/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // 帖子详情
    const thread = db.prepare(`
      SELECT t.*, u.username, u.avatar, u.role,
        EXISTS(SELECT 1 FROM forum_likes WHERE thread_id = t.id AND user_id = ?) as is_liked
      FROM forum_threads t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = ?
    `).get(userId, parseInt(id));

    if (!thread) return res.status(404).json({ error: '帖子不存在' });

    // 更新浏览量
    db.prepare('UPDATE forum_threads SET view_count = view_count + 1 WHERE id = ?').run(id);

    // 回复列表
    const posts = db.prepare(`
      SELECT fp.*, u.username, u.avatar, u.role,
        EXISTS(SELECT 1 FROM forum_post_likes WHERE post_id = fp.id AND user_id = ?) as is_liked
      FROM forum_posts fp
      JOIN users u ON fp.user_id = u.id
      WHERE fp.thread_id = ? AND fp.status = 'active'
      ORDER BY fp.created_at ASC
    `).all(userId, id);

    // 标签
    const tags = db.prepare(`SELECT tag_name FROM forum_thread_tags WHERE thread_id = ?`).all(id);

    res.json({ thread: { ...thread, tags: tags.map(t => t.tag_name), replies: posts } });
  } catch (error) {
    console.error('获取帖子详情失败:', error);
    res.status(500).json({ error: '获取帖子详情失败' });
  }
});

// 发布帖子
router.post('/threads', authenticateToken, (req, res) => {
  try {
    const { title, content, forum_id, tags, scope, class_id } = req.body;

    if (!title || !title.trim()) return res.status(400).json({ error: '标题不能为空' });
    if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

    const forum = db.prepare('SELECT * FROM forums WHERE id = ?').get(forum_id);
    if (!forum) return res.status(404).json({ error: '论坛板块不存在' });

    // 解析 class_id：
    // scope='public' -> class_id = NULL
    // scope='class' / 默认 -> 使用传入 class_id，其次回退到 user.class_id
    let threadClassId = null;
    if (scope !== 'public') {
      const meClassId = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId)?.class_id;
      threadClassId = class_id ? parseInt(class_id, 10) : (meClassId || null);
    }

    const result = db.prepare(`
      INSERT INTO forum_threads (user_id, forum_id, title, content, class_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.userId, parseInt(forum_id), title.trim(), content.trim(), threadClassId);

    const threadId = result.lastInsertRowid;

    // 添加标签
    if (tags && Array.isArray(tags)) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO forum_thread_tags (thread_id, tag_name) VALUES (?, ?)');
      tags.forEach(tag => insertTag.run(threadId, tag));
    }

    // 创建主楼（不再是自动回复）
    db.prepare(`
      INSERT INTO forum_posts (thread_id, user_id, content, is_first_post, class_id)
      VALUES (?, ?, ?, 1, ?)
    `).run(threadId, req.user.userId, content.trim(), threadClassId);

    // 更新板块的帖子数量
    db.prepare(`
      UPDATE forums SET 
        thread_count = (SELECT COUNT(*) FROM forum_threads WHERE forum_id = ? AND status != 'deleted'),
        post_count = (SELECT COUNT(*) FROM forum_posts fp JOIN forum_threads ft ON fp.thread_id = ft.id WHERE ft.forum_id = ? AND fp.status = 'active')
      WHERE id = ?
    `).run(parseInt(forum_id), parseInt(forum_id), parseInt(forum_id));

    res.status(201).json({ message: '发布成功', thread_id: threadId });
  } catch (error) {
    console.error('发布帖子失败:', error);
    res.status(500).json({ error: '发布帖子失败' });
  }
});

// 回复帖子
router.post('/threads/:id/reply', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { content, parent_id } = req.body;

    if (!content || !content.trim()) return res.status(400).json({ error: '回复内容不能为空' });

    const thread = db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(id);
    if (!thread || thread.status === 'deleted') return res.status(404).json({ error: '帖子不存在' });

    const result = db.prepare(`
      INSERT INTO forum_posts (thread_id, user_id, content, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(id, req.user.userId, content.trim(), parent_id || null);

    // 更新帖子的最后回复信息
    db.prepare(`
      UPDATE forum_threads SET
        reply_count = reply_count + 1,
        last_reply_user_id = ?,
        last_reply_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.userId, id);

    // 更新板块的帖子数量
    db.prepare(`
      UPDATE forums SET 
        post_count = (SELECT COUNT(*) FROM forum_posts fp JOIN forum_threads ft ON fp.thread_id = ft.id WHERE ft.forum_id = (SELECT forum_id FROM forum_threads WHERE id = ?) AND fp.status = 'active'),
        thread_count = (SELECT COUNT(*) FROM forum_threads WHERE forum_id = (SELECT forum_id FROM forum_threads WHERE id = ?) AND status != 'deleted')
      WHERE id = (SELECT forum_id FROM forum_threads WHERE id = ?)
    `).run(id, id, id);

    // 通知楼主（如果回复者不是楼主）
    if (thread.user_id !== req.user.userId) {
      const replier = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'forum_reply', '你的帖子收到新回复', ?, 'forum_thread', ?)
      `).run(thread.user_id, `${replier.username} 回复了你的帖子「${thread.title}」`, id);
    }

    // 如果是回复楼层，也通知被回复的人
    if (parent_id) {
      const parentPost = db.prepare('SELECT user_id FROM forum_posts WHERE id = ?').get(parent_id);
      if (parentPost && parentPost.user_id !== req.user.userId && parentPost.user_id !== thread.user_id) {
        const replier = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'forum_quote', '有人在帖子中引用了你', ?, 'forum_post', ?)
        `).run(parentPost.user_id, `${replier.username} 在帖子中回复了你`, parent_id);
      }
    }

    const post = db.prepare(`
      SELECT fp.*, u.username, u.avatar
      FROM forum_posts fp JOIN users u ON fp.user_id = u.id
      WHERE fp.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ message: '回复成功', post });
  } catch (error) {
    console.error('回复帖子失败:', error);
    res.status(500).json({ error: '回复帖子失败' });
  }
});

// 帖子点赞/取消点赞
router.post('/threads/:id/like', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const existingLike = db.prepare('SELECT * FROM forum_likes WHERE thread_id = ? AND user_id = ?').get(id, userId);

    if (existingLike) {
      db.prepare('DELETE FROM forum_likes WHERE id = ?').run(existingLike.id);
      db.prepare("UPDATE forum_threads SET like_count = MAX(0, like_count - 1) WHERE id = ?").run(id);
      res.json({ liked: false });
    } else {
      db.prepare('INSERT INTO forum_likes (thread_id, user_id) VALUES (?, ?)').run(id, userId);
      db.prepare("UPDATE forum_threads SET like_count = COALESCE(like_count, 0) + 1 WHERE id = ?").run(id);

      const thread = db.prepare('SELECT user_id, title FROM forum_threads WHERE id = ?').get(id);
      if (thread && thread.user_id !== userId) {
        const liker = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'forum_like', '你的帖子收到新点赞', ?, 'forum_thread', ?)
        `).run(thread.user_id, `${liker.username} 赞了你的帖子「${thread.title}」`, id);
      }

      res.json({ liked: true });
    }
  } catch (error) {
    console.error('点赞操作失败:', error);
    res.status(500).json({ error: '点赞操作失败' });
  }
});

// 楼层点赞/取消点赞
router.post('/posts/:id/like', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const existingLike = db.prepare('SELECT * FROM forum_post_likes WHERE post_id = ? AND user_id = ?').get(id, userId);

    if (existingLike) {
      db.prepare('DELETE FROM forum_post_likes WHERE id = ?').run(existingLike.id);
      db.prepare("UPDATE forum_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").run(id);
      const post = db.prepare('SELECT like_count FROM forum_posts WHERE id = ?').get(id);
      res.json({ liked: false, like_count: post.like_count });
    } else {
      db.prepare('INSERT INTO forum_post_likes (post_id, user_id) VALUES (?, ?)').run(id, userId);
      db.prepare("UPDATE forum_posts SET like_count = COALESCE(like_count, 0) + 1 WHERE id = ?").run(id);
      const post = db.prepare('SELECT like_count FROM forum_posts WHERE id = ?').get(id);
      res.json({ liked: true, like_count: post.like_count });
    }
  } catch (error) {
    console.error('楼层点赞失败:', error);
    res.status(500).json({ error: '楼层点赞失败' });
  }
});

// 收藏/取消收藏帖子
router.post('/threads/:id/favorite', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const existingFav = db.prepare('SELECT * FROM forum_favorites WHERE thread_id = ? AND user_id = ?').get(id, userId);

    if (existingFav) {
      db.prepare('DELETE FROM forum_favorites WHERE id = ?').run(existingFav.id);
      res.json({ favorited: false });
    } else {
      db.prepare('INSERT INTO forum_favorites (thread_id, user_id) VALUES (?, ?)').run(id, userId);
      res.json({ favorited: true });
    }
  } catch (error) {
    console.error('收藏操作失败:', error);
    res.status(500).json({ error: '收藏操作失败' });
  }
});

// 获取我的收藏
router.get('/favorites', authenticateToken, (req, res) => {
  try {
    const favorites = db.prepare(`
      SELECT t.*, ff.created_at as favorite_time, u.username as author_name
      FROM forum_favorites ff
      JOIN forum_threads t ON ff.thread_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE ff.user_id = ? AND t.status != 'deleted'
      ORDER BY ff.created_at DESC
    `).all(req.user.userId);

    res.json({ favorites });
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    res.status(500).json({ error: '获取收藏列表失败' });
  }
});

// 删除帖子（管理员或作者）
router.delete('/threads/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const thread = db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(id);

    if (!thread) return res.status(404).json({ error: '帖子不存在' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && thread.user_id !== req.user.userId) {
      return res.status(403).json({ error: '无权删除此帖子' });
    }

    db.prepare("UPDATE forum_threads SET status = 'deleted' WHERE id = ?").run(id);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除帖子失败:', error);
    res.status(500).json({ error: '删除帖子失败' });
  }
});

module.exports = router;
