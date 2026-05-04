# 班级宠物养成系统

一个将学习与游戏化深度结合的班级宠物养成平台，学生通过完成作业、每日任务、战斗对战等方式培养专属宠物，实现寓教于乐的学习体验。

## 功能特性

### 核心功能

| 模块 | 功能描述 |
|------|----------|
| **宠物系统** | 12种宠物选择（光明鸟、冰晶熊、圣光兽、大地象、岩石鳄、幻影猫、幽冥蝠、晨星灵、暗影狼、极地狐、梦魇犬、森林鹿），5阶段成长（初生期→幼年期→成长期→成年期→完全体→究极体），属性养成（攻击、防御、速度、生命、心情、饥饿度），技能系统，进化机制 |
| **作业系统** | AI 作业生成（GPT 大模型），客观题自动批改，主观题 AI 评分，错题本智能管理，作业提交图片上传，知识点关联 |
| **战斗系统** | 1v1 对战、BOSS 战、属性克制（火→草→水→火，光↔暗），回合制战斗，实时匹配，战斗奖励 |
| **社交系统** | 好友系统，好友对战，礼物赠送，聊天室，班级论坛，班级动态 |
| **装备系统** | 武器、防具、饰品装备，属性加成，装备强化 |
| **成就系统** | 丰富的成就任务，解锁奖励，称号系统 |
| **排行榜** | 等级排行、战斗排行、作业完成度排行、宠物排行 |
| **每日任务** | 签到、活跃任务，经验奖励 |
| **班级管理** | 班级创建、学生管理、教师管理、班级 BOSS 战、班级首页展示 |
| **教师功能** | 发布作业、查看学情统计、管理班级学生、作业模板 |
| **管理后台** | 用户管理、学校管理、班级管理、数据统计、系统设置 |

### 特色亮点

- **AI 作业批改**：集成大模型 API，智能生成作业并批改主观题
- **属性克制系统**：火→草→水→火循环，光暗相互克制
- **多维度成长**：经验、金币、装备、技能多维度提升宠物实力
- **班级生态**：班级排行榜、BOSS 战，集体荣誉感
- **数据可视化**：学习仪表盘、知识点掌握进度

## 技术栈

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

## 项目结构

```
pet/
├── backend/
│   ├── src/
│   │   ├── config/          # 数据库配置
│   │   ├── middleware/      # 认证中间件
│   │   ├── routes/         # API 路由
│   │   │   ├── achievements.js  # 成就系统
│   │   │   ├── admin.js         # 管理后台
│   │   │   ├── ai-coach.js     # AI 教练
│   │   │   ├── assignments.js   # 作业系统
│   │   │   ├── auth.js          # 认证
│   │   │   ├── battles.js       # 战斗系统
│   │   │   ├── boss-battles.js # BOSS 战
│   │   │   ├── chat.js          # 聊天室
│   │   │   ├── classes.js       # 班级管理
│   │   │   ├── daily-tasks.js  # 每日任务
│   │   │   ├── equipment.js     # 装备系统
│   │   │   ├── forum.js         # 论坛
│   │   │   ├── friends.js       # 好友系统
│   │   │   ├── items.js         # 物品系统
│   │   │   ├── knowledge-points.js # 知识点
│   │   │   ├── leaderboard.js   # 排行榜
│   │   │   ├── notifications.js # 通知
│   │   │   ├── pets.js          # 宠物系统
│   │   │   ├── posts.js         # 帖子
│   │   │   ├── schools.js       # 学校
│   │   │   ├── skills.js        # 技能
│   │   │   └── users.js         # 用户
│   │   └── server.js            # 入口文件
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/     # 组件
│   │   │   ├── AchievementCenter.tsx  # 成就中心
│   │   │   ├── AdminHome.tsx          # 管理后台首页
│   │   │   ├── Arena.tsx              # 竞技场
│   │   │   ├── Assignments.tsx        # 作业
│   │   │   ├── Battle.tsx             # 战斗
│   │   │   ├── BossBattle.tsx         # BOSS 战
│   │   │   ├── BossBattleManager.tsx  # BOSS 战管理
│   │   │   ├── ChatRoom.tsx           # 聊天室
│   │   │   ├── ClassDashboard.tsx     # 班级仪表盘
│   │   │   ├── CreatePet.tsx          # 创建宠物
│   │   │   ├── DailyTasks.tsx        # 每日任务
│   │   │   ├── EquipmentPanel.tsx     # 装备面板
│   │   │   ├── Forum.tsx              # 论坛
│   │   │   ├── Friends.tsx            # 好友
│   │   │   ├── LearningDashboard.tsx  # 学习仪表盘
│   │   │   ├── Notifications.tsx      # 通知
│   │   │   ├── PetCenter.tsx          # 宠物中心
│   │   │   ├── PetDisplay.tsx         # 宠物展示
│   │   │   ├── PetSkills.tsx          # 宠物技能
│   │   │   ├── Profile.tsx            # 个人资料
│   │   │   ├── ShopAndBackpack.tsx    # 商店和背包
│   │   │   ├── SocialHub.tsx          # 社交中心
│   │   │   ├── StudentDashboard.tsx   # 学生仪表盘
│   │   │   ├── StudyCenter.tsx        # 学习中心
│   │   │   ├── TeacherDashboard.tsx   # 教师仪表盘
│   │   │   ├── WrongQuestions.tsx     # 错题本
│   │   │   └── admin/                  # 管理组件
│   │   ├── pages/            # 页面
│   │   ├── store/            # 状态管理
│   │   ├── utils/            # 工具函数
│   │   └── App.tsx           # 主组件
│   └── package.json
└── README.md
```

## 快速开始

### 方式一：Docker 部署（推荐）

详见 [docker.md](./docker.md)

```bash
# 1. 创建部署目录
mkdir -p /opt/pet && cd /opt/pet

# 2. 下载 docker-compose.yml（或从项目复制）
# 3. 拉取镜像并启动
docker compose pull
docker compose up -d

# 4. 访问 http://localhost
```

### 方式二：本地开发

#### 环境要求

- Node.js >= 18.x
- npm >= 9.x

#### 后端

```bash
cd backend
npm install
cp .env.example .env
# 编辑 .env 填入 AI_API_KEY 等配置
npm run dev        # http://localhost:3000
```

#### 前端

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## 环境变量

```bash
# 服务器配置
PORT=3000
NODE_ENV=production

# JWT 配置
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# AI 服务配置
AI_API_KEY=your-api-key
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_MODEL=doubao-seed-2-0-pro-260215

# 前端地址（用于 CORS 和邀请链接）
FRONTEND_URL=https://your-domain.com
```

## 游戏说明

### 宠物属性

| 属性 | 说明 |
|------|------|
| 攻击力 | 影响物理伤害 |
| 防御力 | 减少受到的伤害 |
| 速度 | 决定出手顺序 |
| 健康值 | 归零时无法战斗 |
| 心情值 | 影响战斗表现 |
| 饥饿度 | 需要定期喂食 |

### 成长阶段

1. **初生期**：宠物蛋状态
2. **幼年期**：1-10 级
3. **成长期**：11-30 级
4. **成年期**：31-50 级
5. **完全体**：51-80 级
6. **究极体**：81-100 级

### 宠物类型与克制

| 宠物 | 属性 |
|------|------|
| 光明鸟、圣光兽、晨星灵 | 光 |
| 幽冥蝠、梦魇犬、暗影狼 | 暗 |
| 剧毒蝎 | 毒 |
| 冰晶熊、极地狐 | 冰 |
| 大地象、岩石鳄 | 岩 |
| 幻影猫 | 幻 |
| 水灵龟 | 水 |
| 森林鹿 | 草 |

### 属性克制

- **火 → 草 → 水 → 火**：火克草，草克水，水克火
- **光 ↔ 暗**：光暗互相克制
- 无克制关系时，伤害正常计算

### 获取经验

- 完成作业（主要来源）
- 每日签到
- 战斗胜利
- 完成任务
- 成就奖励

## API 概览

| 模块 | 端点 |
|------|------|
| 认证 | `/api/auth/register`, `/api/auth/login`, `/api/auth/me` |
| 宠物 | `/api/pets/my-pet`, `/api/pets/create`, `/api/pets/feed` |
| 作业 | `/api/assignments`, `/api/assignments/:id/submit` |
| 战斗 | `/api/battles/start`, `/api/battles/history` |
| BOSS 战 | `/api/boss-battles/*` |
| 排行榜 | `/api/leaderboard/level`, `/api/leaderboard/battle` |
| 好友 | `/api/friends/*` |
| 装备 | `/api/equipment/*` |
| 成就 | `/api/achievements/*` |

## 许可证

MIT License
