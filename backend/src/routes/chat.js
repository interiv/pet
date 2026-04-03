const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== 聊天系统 ====================

// 获取用户的聊天列表（群聊 + 私聊）
router.get('/conversations', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;

    // 获取用户所在班级
    const user = db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId);

    // 班级群聊
    const classChats = [];
    if (user && user.class_id) {
      const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(user.class_id);
      if (cls) {
        // 获取最后一条消息
        const lastMsg = db.prepare(`
          SELECT * FROM chat_messages
          WHERE room_type = 'class' AND room_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(cls.id);

        const unreadCount = db.prepare(`
          SELECT COUNT(*) as cnt FROM chat_messages
          WHERE room_type = 'class' AND room_id = ? AND user_id != ?
            AND created_at > COALESCE(
              (SELECT last_read_at FROM chat_read_status
                WHERE user_id = ? AND room_type = 'class' AND room_id = ?),
              '2000-01-01'
            )
        `).get(cls.id, userId, userId, cls.id).cnt;

        classChats.push({
          type: 'class',
          room_id: cls.id,
          name: `${cls.name} 班级群`,
          last_message: lastMsg?.content || '',
          unread_count: unreadCount,
          member_count: db.prepare('SELECT COUNT(*) as cnt FROM users WHERE class_id = ? AND status = "active"').get(cls.id).cnt
        });
      }
    }

    // 私聊列表（最近有消息的）
    const privateChats = db.prepare(`
      SELECT DISTINCT
        CASE WHEN cm.user_id = ? THEN cm.target_user_id ELSE cm.user_id END as other_user_id,
        u.username, u.avatar, u.role,
        MAX(cm.created_at) as last_msg_time
      FROM chat_messages cm
      JOIN users u ON u.id = CASE WHEN cm.user_id = ? THEN cm.target_user_id ELSE cm.user_id END
      WHERE (cm.user_id = ? OR cm.target_user_id = ?)
        AND cm.room_type = 'private'
      GROUP BY CASE WHEN cm.user_id = ? THEN cm.target_user_id ELSE cm.user_id END
      ORDER BY last_msg_time DESC
      LIMIT 20
    `).all(userId, userId, userId, userId, userId);

    const privateChatList = privateChats.map(chat => {
      const lastMsg = db.prepare(`
        SELECT * FROM chat_messages
        WHERE ((user_id = ? AND target_user_id = ?) OR (user_id = ? AND target_user_id = ?))
          AND room_type = 'private'
        ORDER BY created_at DESC LIMIT 1
      `).get(userId, chat.other_user_id, chat.other_user_id, userId);

      const unreadCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM chat_messages
        WHERE user_id = ? AND target_user_id = ? AND room_type = 'private'
          AND created_at > COALESCE(
            (SELECT last_read_at FROM chat_read_status
              WHERE user_id = ? AND target_user_id = ?),
            '2000-01-01'
          )
      `).get(chat.other_user_id, userId, userId, chat.other_user_id).cnt;

      return {
        type: 'private',
        user_id: chat.other_user_id,
        target_user_id: chat.other_user_id,
        name: chat.username,
        avatar: chat.avatar,
        last_message: lastMsg?.content || '',
        last_time: chat.last_msg_time || lastMsg?.created_at || '',
        unread_count: unreadCount
      };
    });

    res.json({ conversations: [...classChats, ...privateChatList] });
  } catch (error) {
    console.error('获取聊天列表失败:', error);
    res.status(500).json({ error: '获取聊天列表失败' });
  }
});

// 获取聊天记录
router.get('/messages', authenticateToken, (req, res) => {
  try {
    const { room_type, room_id, target_user_id, page = 1, limit = 50 } = req.query;
    const userId = req.user.userId;
    const offset = (page - 1) * limit;

    let messages;

    if (room_type === 'class') {
      // 权限检查：是否在该班级
      const userClassId = db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId)?.class_id;
      if (!userClassId || parseInt(userClassId) !== parseInt(room_id)) {
        return res.status(403).json({ error: '无权访问该班级群聊' });
      }

      messages = db.prepare(`
        SELECT cm.*, u.username, u.avatar, u.role
        FROM chat_messages cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.room_type = 'class' AND cm.room_id = ?
        ORDER BY cm.created_at ASC
        LIMIT ? OFFSET ?
      `).all(parseInt(room_id), parseInt(limit), parseInt(offset));

      // 更新已读状态
      db.prepare(`
        INSERT INTO chat_read_status (user_id, room_type, room_id, last_read_at)
        VALUES (?, 'class', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, room_type, room_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP
      `).run(userId, parseInt(room_id));
    } else if (room_type === 'private') {
      // 私聊
      const targetId = target_user_id;
      if (!targetId) return res.status(400).json({ error: '缺少目标用户ID' });

      messages = db.prepare(`
        SELECT cm.*, u.username, u.avatar, u.role
        FROM chat_messages cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.room_type = 'private'
          AND (
            (cm.user_id = ? AND cm.target_user_id = ?)
            OR (cm.user_id = ? AND cm.target_user_id = ?)
          )
        ORDER BY cm.created_at ASC
        LIMIT ? OFFSET ?
      `).all(userId, parseInt(targetId), parseInt(targetId), userId, parseInt(limit), parseInt(offset));

      // 更新已读状态
      db.prepare(`
        INSERT INTO chat_read_status (user_id, target_user_id, last_read_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, target_user_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP
      `).run(userId, parseInt(targetId));
    } else {
      return res.status(400).json({ error: '无效的聊天类型' });
    }

    res.json({ messages });
  } catch (error) {
    console.error('获取聊天记录失败:', error);
    res.status(500).json({ error: '获取聊天记录失败' });
  }
});

// 发送消息（同时通过 Socket.IO 实时推送）
router.post('/messages', authenticateToken, (req, res) => {
  try {
    const { content, room_type, room_id, target_user_id, msg_type = 'text' } = req.body;
    const userId = req.user.userId;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    let result;

    if (room_type === 'class') {
      // 检查是否在班级中
      const userClassId = db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId)?.class_id;
      if (!userClassId || parseInt(userClassId) !== parseInt(room_id)) {
        return res.status(403).json({ error: '不在该班级中，无法发送消息' });
      }

      result = db.prepare(`
        INSERT INTO chat_messages (user_id, room_type, room_id, content, msg_type)
        VALUES (?, 'class', ?, ?, ?)
      `).run(userId, parseInt(room_id), content.trim(), msg_type);
    } else if (room_type === 'private') {
      if (!target_user_id) return res.status(400).json({ error: '私聊需要指定目标用户' });

      result = db.prepare(`
        INSERT INTO chat_messages (user_id, room_type, target_user_id, content, msg_type)
        VALUES (?, 'private', ?, ?, ?)
      `).run(userId, parseInt(target_user_id), content.trim(), msg_type);
    } else {
      return res.status(400).json({ error: '无效的聊天类型' });
    }

    const message = db.prepare(`
      SELECT cm.*, u.username, u.avatar, u.role
      FROM chat_messages cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ message: message });
  } catch (error) {
    console.error('发送消息失败:', error);
    res.status(500).json({ error: '发送消息失败' });
  }
});

// 搜索用户（用于发起私聊）
router.get('/search-users', authenticateToken, (req, res) => {
  try {
    const { keyword } = req.query;
    const userId = req.user.userId;

    if (!keyword || keyword.length < 1) {
      return res.json({ users: [] });
    }

    const users = db.prepare(`
      SELECT id, username, avatar, role, class_id
      FROM users
      WHERE status = 'active' AND id != ? AND username LIKE ?
      ORDER BY username
      LIMIT 20
    `).all(userId, `%${keyword}%`);

    res.json({ users });
  } catch (error) {
    console.error('搜索用户失败:', error);
    res.status(500).json({ error: '搜索用户失败' });
  }
});

// 删除消息（管理员或消息发送者）
router.delete('/messages/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);

    if (!msg) return res.status(404).json({ error: '消息不存在' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && msg.user_id !== req.user.userId) {
      return res.status(403).json({ error: '只能删除自己的消息' });
    }

    db.prepare('UPDATE chat_messages SET deleted = 1 WHERE id = ?').run(id);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除消息失败:', error);
    res.status(500).json({ error: '删除消息失败' });
  }
});

module.exports = router;
