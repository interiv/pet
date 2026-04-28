const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const petRoutes = require('./routes/pets');
const assignmentRoutes = require('./routes/assignments');
const battleRoutes = require('./routes/battles');
const itemRoutes = require('./routes/items');
const friendRoutes = require('./routes/friends');
const achievementRoutes = require('./routes/achievements');
const leaderboardRoutes = require('./routes/leaderboard');
const equipmentRoutes = require('./routes/equipment');
const adminRoutes = require('./routes/admin');
const postRoutes = require('./routes/posts');
const chatRoutes = require('./routes/chat');
const forumRoutes = require('./routes/forum');
const notificationRoutes = require('./routes/notifications');
const classRoutes = require('./routes/classes');
const dailyTasksModule = require('./routes/daily-tasks');
const knowledgePointRoutes = require('./routes/knowledge-points');
const skillRoutes = require('./routes/skills');
const bossBattleRoutes = require('./routes/boss-battles');
const schoolRoutes = require('./routes/schools');

// 初始化数据库
initDatabase();

const app = express();
const server = http.createServer(app);

// Socket.IO 初始化（用于战斗和实时互动）
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// 中间件
app.use(helmet()); // 安全头
app.use(compression()); // 压缩响应
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true
}));
app.use(morgan('dev')); // 日志
app.use(express.json()); // JSON 解析
app.use(express.urlencoded({ extended: true }));

// 静态文件目录（上传的文件和前端图片）
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/images', express.static(path.join(__dirname, '../../frontend/public/images')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/pets', petRoutes.router);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/battles', battleRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/daily-tasks', dailyTasksModule.router);
app.use('/api/knowledge-points', knowledgePointRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/boss-battles', bossBattleRoutes);
app.use('/api/schools', schoolRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '班级宠物养成系统运行中' });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '未找到请求的资源' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('错误:', err);
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误'
  });
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);

  // 加入战斗房间
  socket.on('join-battle', (battleId) => {
    socket.join(`battle:${battleId}`);
    console.log(`用户 ${socket.id} 加入战斗房间：${battleId}`);
  });

  // 战斗动作
  socket.on('battle-action', (data) => {
    socket.to(`battle:${data.battleId}`).emit('battle-action', data);
  });

  // 宠物互动
  socket.on('pet-interaction', (data) => {
    socket.to(`user:${data.targetUserId}`).emit('pet-interaction', data);
  });

  // ==================== 聊天系统 ====================

  // 加入班级群聊房间
  socket.on('join-class-chat', (classId) => {
    socket.join(`class:${classId}`);
    console.log(`用户 ${socket.id} 加入班级群聊：${classId}`);
  });

  // 离开班级群聊
  socket.on('leave-class-chat', (classId) => {
    socket.leave(`class:${classId}`);
    console.log(`用户 ${socket.id} 离开班级群聊：${classId}`);
  });

  // 班级群聊消息（实时广播）
  socket.on('send-class-message', (data) => {
    const { classId, message } = data;
    io.to(`class:${classId}`).emit('new-class-message', message);
  });

  // 加入私聊房间（用两个用户的ID排序组合作为房间名）
  socket.on('join-private-chat', ({ userId1, userId2 }) => {
    const roomId = `private:${[userId1, userId2].sort((a, b) => a - b).join('-')}`;
    socket.join(roomId);
    console.log(`用户 ${socket.id} 加入私聊房间：${roomId}`);
  });

  // 私聊消息（实时推送）
  socket.on('send-private-message', (data) => {
    const { targetUserId, message } = data;
    const roomId = `private:${[message.user_id, targetUserId].sort((a, b) => a - b).join('-')}`;
    io.to(roomId).emit('new-private-message', message);
  });

  // 用户正在输入中
  socket.on('typing-in-class', (data) => {
    socket.to(`class:${data.classId}`).emit('user-typing', { username: data.username });
  });

  socket.on('typing-in-private', (data) => {
    const roomId = `private:${[data.userId, data.targetUserId].sort((a, b) => a - b).join('-')}`;
    socket.to(roomId).emit('user-typing', { username: data.username });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开连接:', socket.id);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境：${process.env.NODE_ENV}`);
});

module.exports = { app, io };
