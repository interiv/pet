# 快速启动指南 🚀

## 第一步：安装 Node.js

如果尚未安装 Node.js，请访问 https://nodejs.org/ 下载并安装 LTS 版本（推荐 16.x 或更高版本）。

安装完成后，在命令行中验证：
```bash
node -v
npm -v
```

## 第二步：安装后端依赖

打开命令行，进入项目目录：

```bash
cd c:\Users\Administrator\Desktop\pet\backend
```

安装依赖包：
```bash
npm install
```

## 第三步：配置环境变量

编辑 `backend\.env` 文件，根据实际情况修改配置：

```bash
PORT=3000
NODE_ENV=development

JWT_SECRET=class-pet-game-secret-key-2024
JWT_EXPIRES_IN=7d

DATABASE_PATH=./data/pets.db

# AI 服务配置（暂时使用示例配置，后续可接入真实 AI API）
AI_API_ENDPOINT=https://api.example.com/v1
AI_API_KEY=your-ai-api-key
AI_MODEL=gpt-3.5-turbo
AI_TIMEOUT=30000

UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

FRONTEND_URL=http://localhost:5173
```

## 第四步：初始化数据库

在 backend 目录下执行：
```bash
node src/config/seed.js
```

这将创建数据库表并插入基础数据（宠物种类、物品、装备、技能等）。

## 第五步：启动后端服务器

在 backend 目录下执行：
```bash
npm run dev
```

看到以下信息表示启动成功：
```
数据库初始化成功
服务器运行在端口 3000
环境：development
```

## 第六步：安装前端依赖

**打开新的命令行窗口**，进入前端目录：

```bash
cd c:\Users\Administrator\Desktop\pet\frontend
```

安装依赖包：
```bash
npm install
```

## 第七步：启动前端开发服务器

在前端目录下执行：
```bash
npm run dev
```

看到以下信息表示启动成功：
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

## 第八步：访问系统

在浏览器中打开：**http://localhost:5173**

## 第九步：注册账号

1. 点击"立即注册"链接
2. 填写用户名、密码等信息
3. 选择角色（学生或教师）
4. 点击"注册"按钮

## 第十步：创建宠物

注册成功后，系统会引导你创建第一只宠物：
1. 给宠物起个名字
2. 选择宠物种类（火焰狮、水灵龟、森林鹿、光明鸟、暗影狼）
3. 点击"开始养成之旅"

## 🎉 开始使用

现在你可以：
- 📚 查看和完成作业获得经验
- 🍖 投喂你的宠物
- ⚔️ 与其他同学的宠物对战
- 👫 添加好友，拜访宠物
- 🏆 查看排行榜
- 🎯 完成任务和成就

## 常见问题

### Q: 端口被占用怎么办？
A: 修改 `backend\.env` 中的 `PORT` 值，或修改 `frontend\vite.config.js` 中的端口配置。

### Q: 安装依赖失败？
A: 尝试使用淘宝镜像：
```bash
npm config set registry https://registry.npmmirror.com
npm install
```

### Q: 数据库文件在哪里？
A: 首次运行后会在 `backend/data/` 目录下生成 `pets.db` 文件。

### Q: 如何重置数据？
A: 删除 `backend/data/pets.db` 文件，然后重新运行 `node src/config/seed.js`。

## 下一步

- 完善宠物形象设计
- 接入真实的 AI 批改 API
- 实现战斗动画效果
- 添加更多互动功能

祝你使用愉快！🎮🐾
