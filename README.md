# 班级宠物养成系统 🐾

一个将学习与游戏化结合的班级宠物养成平台，通过完成作业获得经验值，培养专属宠物，与其他同学互动对战！

## ✨ 功能特性

### 🎮 核心功能
- **宠物养成**: 选择初始宠物，通过投喂、训练培养成长
- **作业系统**: 完成作业获得经验值，AI 自动批改主观题
- **战斗系统**: 回合制宠物对战，1v1、3v3 多种模式
- **社交互动**: 添加好友、拜访宠物、赠送礼物
- **排行榜**: 等级、战斗、作业完成度多维度排行
- **成就系统**: 丰富的成就任务等待解锁

### 🎯 特色亮点
- **AI 作业批改**: 集成大模型 API，智能批改主观题
- **宠物进化**: 5 个成长阶段（幼年→青年→成年→完全体→究极体）
- **属性克制**: 火→草→水→火，光↔暗
- **装备系统**: 武器、防具、饰品自由搭配
- **班级看板**: 全班宠物展示，学习进度可视化

## 🛠️ 技术栈

### 后端
- Node.js + Express
- SQLite 数据库
- Socket.IO（实时通信）
- JWT 认证
- AI API 集成

### 前端
- React + TypeScript
- Vite
- Ant Design
- Zustand（状态管理）
- Tailwind CSS

## 📦 安装步骤

### 1. 环境要求
- Node.js >= 16.x
- npm >= 8.x

### 2. 后端安装

```bash
cd backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑.env 文件，填入 AI API 密钥等配置

# 初始化数据库
node src/config/seed.js

# 启动开发服务器
npm run dev
```

### 3. 前端安装

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 4. 访问系统
- 前端：http://localhost:5173
- 后端 API：http://localhost:3000/api

## 📁 项目结构

```
pet/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js    # 数据库配置
│   │   │   └── seed.js        # 数据初始化
│   │   ├── routes/            # API 路由
│   │   ├── middleware/        # 中间件
│   │   ├── controllers/       # 控制器
│   │   ├── models/            # 模型
│   │   ├── services/          # 服务层
│   │   └── server.js          # 入口文件
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/        # 组件
│   │   ├── pages/             # 页面
│   │   ├── store/             # 状态管理
│   │   ├── utils/             # 工具函数
│   │   └── App.tsx            # 主组件
│   └── package.json
└── README.md
```

## 🎮 游戏说明

### 宠物属性
- **攻击力**: 影响物理伤害
- **防御力**: 减少受到的伤害
- **速度**: 决定出手顺序
- **健康值**: 归零时无法战斗
- **心情值**: 影响战斗表现
- **饥饿度**: 需要定期喂食

### 成长阶段
1. **幼年期** (1-10 级): 🥚
2. **青年期** (11-30 级): 🐣
3. **成年期** (31-50 级): 🦅
4. **完全体** (51-80 级): ✨
5. **究极体** (81-100 级): 🌟

### 获取经验
- ✅ 完成作业（主要来源）
- 🎁 每日签到
- 🏆 战斗胜利
- 🎯 完成任务
- 📦 成就奖励

## ⚙️ 配置说明

### 环境变量 (.env)
```bash
# 服务器配置
PORT=3000
NODE_ENV=development

# JWT 配置
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# AI 服务配置
AI_API_ENDPOINT=https://api.example.com/v1
AI_API_KEY=your-ai-api-key
AI_MODEL=gpt-3.5-turbo

# 前端地址
FRONTEND_URL=http://localhost:5173
```

## 🔌 API 文档

### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户

### 宠物相关
- `GET /api/pets/my-pet` - 获取我的宠物
- `POST /api/pets/create` - 创建宠物
- `POST /api/pets/feed` - 投喂宠物
- `GET /api/pets/all` - 所有宠物列表

### 作业相关
- `GET /api/assignments` - 作业列表
- `POST /api/assignments` - 创建作业（教师）
- `POST /api/assignments/:id/submit` - 提交作业
- `POST /api/assignments/grade` - 批改作业

### 战斗相关
- `POST /api/battles/start` - 发起战斗
- `GET /api/battles/history` - 战斗记录

### 排行榜
- `GET /api/leaderboard/level` - 等级排行
- `GET /api/leaderboard/battle` - 战斗排行
- `GET /api/leaderboard/assignment` - 作业排行

## 🎯 开发计划

### 已完成
- ✅ 项目基础架构
- ✅ 用户认证系统
- ✅ 宠物基础系统
- ✅ 作业提交功能
- ✅ 战斗系统框架
- ✅ 前端基础页面

### 待完成
- ⏳ AI 批改集成
- ⏳ 战斗动画
- ⏳ 社交互动功能
- ⏳ 成就系统
- ⏳ 任务系统
- ⏳ 班级看板

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 👨‍💻 开发团队

班级宠物养成系统开发组

---

**让学习变得更有趣！🎓🎮**
