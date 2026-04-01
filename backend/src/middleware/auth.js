const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

// 验证 JWT Token 中间件
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: '未提供认证令牌' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;

    // 验证用户是否仍然存在及状态
    const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    
    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: '您的账号正在审核中，请联系管理员。' });
    } else if (user.status !== 'active') {
      return res.status(403).json({ error: '您的账号已被禁用或状态异常。' });
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: '无效的令牌' });
    }
    console.error('认证错误:', error);
    return res.status(500).json({ error: '认证失败' });
  }
};

// 验证角色权限中间件
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }

    next();
  };
};

// 可选认证（有 token 则验证，没有也允许访问）
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }

    next();
  } catch (error) {
    // Token 无效但继续执行，当作未登录用户
    next();
  }
};

module.exports = { authenticateToken, authorizeRole, optionalAuth };
