// 最顶部加载：给所有 console 输出加上日期时间戳（必须在其他模块之前 require）
require('./config/logger');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const { runMigrations } = require('./config/migrate');
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
const systemRoutes = require('./routes/system');
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
const aiCoachRoutes = require('./routes/ai-coach');
const questionBankRoutes = require('./routes/question-bank');
const cardRoutes = require('./routes/cards');

// 初始化数据库
initDatabase();

const { db } = require('./config/database');

// 未配置 FRONTEND_URL 时（本地开发 / 首次部署）默认为空数组会拒绝所有跨域请求，
// 这里回退到本地常用开发地址，避免出现「接口通但前端全被 CORS 拦掉」的假故障。
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

console.log(`CORS 允许来源: ${allowedOrigins.join(', ') || '(无)'}`);

const app = express();
const server = http.createServer(app);

// Socket.IO 初始化（用于战斗和实时互动）
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// 暴露 io 给各路由使用
app.set('io', io);

// 中间件
app.use(helmet()); // 安全头
app.use(compression()); // 压缩响应
app.use(cors({
  origin: function (origin, callback) {
    // 允许没有 origin 的请求（如移动应用、curl 等）
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('不允许的跨域请求'));
    }
  },
  credentials: true
}));
// 常见扫描/探测路径：直接静默 404
// 说明：这些请求本就取不到任何东西（源码里没有对应的静态目录），
// 放在日志中间件之前，避免 /api/.env、/wp-admin 之类的扫描把控制台刷满。
// 如需追踪扫描来源，可在 Nginx 的 access_log 里查看（请求仍会被 Nginx 记录）。
const SCAN_PATH_RE = /(^|\/)(\.env|\.git|\.svn|\.aws|\.ssh|wp-admin|wp-login|wp-content|phpmyadmin|pma|admin\.php|xmlrpc\.php|config\.php|\.htaccess)/i;
app.use((req, res, next) => {
  if (SCAN_PATH_RE.test(req.path) || /\.(sqlite|sqlite3|db|log|env|bak|old|zip|tar|gz)$/i.test(req.path)) {
    return res.status(404).json({ error: '未找到请求的资源' });
  }
  next();
});

// 请求日志：输出到 console（morgan 默认直接写 stdout，绕过 console 补丁，故这里改走 console.log 以带时间戳）
app.use(morgan('dev', {
  stream: { write: (msg) => console.log(msg.trimEnd()) }
}));
app.use(express.json()); // JSON 解析
app.use(express.urlencoded({ extended: true }));

// 静态文件目录（上传的文件和前端图片）
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// 优先从 public/images 读取图片（生产环境），如果不存在则从原路径读取
app.use('/images', express.static(path.join(__dirname, '../public/images')));
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
app.use('/api/admin/system', systemRoutes);
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
app.use('/api/ai-coach', aiCoachRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/cards', cardRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '班级宠物养成系统运行中' });
});

// 前端静态文件（生产环境）
app.use(express.static(path.join(__dirname, '../public')));

// SPA fallback：非 API 请求都返回 index.html
const PUBLIC_INDEX = path.join(__dirname, '../public/index.html');
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '未找到请求的资源' });
  }
  // 后端未托管前端（前端由 Nginx 提供）时，返回干净的 404，不暴露服务器文件路径
  if (!fs.existsSync(PUBLIC_INDEX)) {
    return res.status(404).json({ error: '未找到请求的资源' });
  }
  res.sendFile(PUBLIC_INDEX);
});

// 错误处理
app.use((err, req, res, next) => {
  // 详细错误只写服务器日志（含堆栈），不返回给客户端，避免泄露文件路径等内部信息
  console.error('错误:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? '服务器内部错误' : (status === 404 ? '未找到请求的资源' : (err.message || '请求失败'))
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

// 启动前自动执行数据库迁移：
// 传文件 + 重启即可完成建表/补列/老数据回填；迁移失败只记日志，不阻断服务启动（管理后台会给出提示）
runMigrations().finally(() => {
  server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`环境：${process.env.NODE_ENV}`);
  });
});

module.exports = { app, io };
