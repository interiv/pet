# 作业系统改进计划 v2

## 一、核心需求确认

### 用户决策
1. ✅ 图片存储：本地服务器存储 (backend/uploads/)
2. ✅ 选择题反馈：统一提交后显示对错（不即时反馈）
3. ✅ 重新作答机制：生成3倍变体题（10道→30道），错题给新变体，3次循环
4. ✅ 主观题限制：仅1次机会，客观/主观必须分开成独立作业
5. ✅ 错题本：本次实现
6. ✅ 代码质量：完成后审查

---

## 二、数据库表结构设计

### 2.1 新增：question_bank 题目库表
```sql
CREATE TABLE question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,           -- 科目
  topic TEXT,                      -- 知识点/主题
  difficulty TEXT DEFAULT 'medium',-- easy/medium/hard
  type TEXT NOT NULL,              -- choice_single/choice_multi/judgment/fill_blank/essay
  content TEXT NOT NULL,           -- 题目内容
  options TEXT,                    -- JSON数组 [A,B,C,D]
  answer TEXT NOT NULL,            -- 正确答案
  explanation TEXT,                -- 解析（生成时一并生成）
  analysis TEXT,                   -- 解题思路/步骤
  hint TEXT,                       -- 提示
  variant_group_id INTEGER,        -- 变体组ID（同组为相似题）
  variant_index INTEGER DEFAULT 0, -- 变体序号 0/1/2
  source TEXT DEFAULT 'ai',        -- ai/manual
  usage_count INTEGER DEFAULT 0,   -- 使用次数
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER               -- 创建者(教师ID)
);
```

### 2.2 新增：assignment_questions 作业-题目关联表
```sql
CREATE TABLE assignment_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  question_bank_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,    -- 排序
  score_weight REAL DEFAULT 1.0,   -- 分值权重
  FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
);
```

### 2.3 新增：question_answers 学生作答详情表
```sql
CREATE TABLE question_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  question_bank_id INTEGER NOT NULL,
  attempt_number INTEGER DEFAULT 1,   -- 第几次尝试(1/2/3...)
  student_answer TEXT,                -- 学生答案
  is_correct INTEGER DEFAULT 0,       -- 是否正确(客观题)
  score REAL,                         -- 得分(主观题)
  max_score REAL,                     -- 满分
  feedback TEXT,                      -- AI评阅反馈
  image_url TEXT,                     -- 上传的图片(主观题)
  reviewed_at DATETIME,               -- 评阅时间
  answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id),
  FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
);
```

### 2.4 修改：submissions 表增加字段
```sql
ALTER TABLE submissions ADD COLUMN total_score REAL;
ALTER TABLE submissions ADD COLUMN total_max_score REAL;
ALTER TABLE submissions ADD COLUMN gold_reward INTEGER DEFAULT 0;
ALTER TABLE submissions ADD COLUMN review_status TEXT DEFAULT 'pending'; -- pending/reviewing/completed
ALTER TABLE submissions ADD COLUMN attempt_count INTEGER DEFAULT 1;
```

### 2.5 修改：assignments 表
- class_id 字段确认已有或添加

### 2.6 错题本表（已有 wrong_questions，需扩展）
```sql
-- 已有 wrong_questions 表，检查字段是否足够
-- 需要: user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed
```

### 2.7 新增：upload_files 文件上传记录表
```sql
CREATE TABLE upload_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  upload_type TEXT DEFAULT 'assignment', -- assignment/avatar/etc
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 三、API接口设计

### 3.1 AI生成题目（增强版）
```
POST /api/assignments/generate
输入:
{
  subject: "数学",
  topic: "二次函数",
  difficulty: "medium",
  question_type: "choice_single",    // 每次只生成一种类型
  count: 10,                         // 要显示的题目数
  grade_level: "高一"
}

输出:
{
  questions: [
    {
      content: "题目内容...",
      options: ["A","B","C","D"],
      answer: "B",
      explanation: "解析...",
      analysis: "解题步骤...",
      variants: [
        { content: "变体1...", options: [...], answer: "C", ... },
        { content: "变体2...", options: [...], answer: "A", ... }
      ]
    },
    ...
  ],
  title: "AI生成的作业标题",
  description: "作业描述"
}
```
**关键**: 实际生成 count * 3 道题，每3道为一组变体

### 3.2 发布作业
```
POST /api/assignments
输入:
{
  title: "...",
  subject: "数学",
  class_id: 1,
  max_exp: 30,
  due_date: "2025-01-20T23:59:00",
  questions: [question_bank_id数组],
  ai_config: { auto_grade: true, question_type: "choice_single" } // 标记题型
}
```

### 3.3 获取作业详情（含题目）
```
GET /api/assignments/:id
返回: 作业信息 + 题目列表（不含答案和解析！）
```

### 3.4 提交作业（客观题）
```
POST /api/assignments/:id/submit
输入:
{
  answers: [
    { question_id: 1, answer: "B" },
    { question_id: 2, answer: "A" },
    ...
  ]
}

输出（立即返回）:
{
  success: true,
  results: [
    { question_id: 1, correct: true, score: 10, explanation: "..." },
    { question_id: 2, correct: false, score: 0, explanation: "...", retry_question: { ... } }
  ],
  total_score: 80,
  gold_reward: 24,
  wrong_count: 2
}
```

### 3.5 提交作业（主观题）
```
POST /api/assignments/:id/submit
输入:
{
  answers: [
    { question_id: 1, answer: "学生文字答案", image_url: "/uploads/xxx.jpg" }
  ]
}

输出:
{
  success: true,
  message: "已提交，等待AI评阅",
  submission_id: 123
}
// 后台异步调用AI评阅
```

### 3.6 重新作答（仅客观题错题）
```
POST /api/assignments/:id/retry
输入:
{
  submission_id: 123,
  answers: [
    { original_question_id: 1, new_question_id: 15, answer: "C" },  // 用变体题作答
    ...
  ]
}
输出: 同submit，但只针对错题
```

### 3.7 获取我的作答结果
```
GET /api/submissions/:id
返回: 每题详情 + 总分 + 金币 + 解析
```

### 3.8 教师查看班级作答统计
```
GET /api/assignments/:id/statistics
返回:
{
  total_students: 40,
  submitted_count: 35,
  completion_rate: 87.5,
  average_score: 78.5,
  question_stats: [
    { question_id: 1, correct_rate: 85, avg_score: 8.5 },
    ...
  ],
  student_results: [
    { user_id: 1, username: "张三", score: 90, submitted_at: "..." },
    ...
  ]
}
```

### 3.9 错题本
```
GET /api/wrong-questions/my          // 我的错题
GET /api/wrong-questions/:id/detail  // 错题详情+解析
POST /api/wrong-questions/:id/review // 标记已复习
```

### 3.10 图片上传
```
POST /api/upload/image
输入: multipart/form-data (file)
输出: { url: "/uploads/xxx.jpg", file_id: 123 }
```

---

## 四、前端页面设计

### 4.1 教师发布作业弹窗（重构）
```
┌─────────────────────────────────────────────┐
│ 发布新作业                              [X]  │
├─────────────────────────────────────────────┤
│ 班级:     [下拉选择班级]                     │
│ 科目:     [下拉选择]                         │
│ 作业标题:  [输入框]                           │
│                                             │
│ ─── AI生成题目 ───                          │
│ 题型:     [单选] [多选] [判断] [简答] [作文] │
│           (每次只能选一种)                    │
│ 主题:     [例如：二次函数顶点坐标]             │
│ 难度:     [简单] [中等] [困难]               │
│ 题目数量: [10] 道                            │
│         [🤖 AI生成题目]                      │
│                                             │
│ ─── 题目预览（可编辑） ───                  │
│ ┌───────────────────────────────────────┐   │
│ │ Q1. xxxxxxx?                          │   │
│ │   ○ A. xxx  ○ B. xxx                 │   │
│ │   ○ C. xxx  ○ D. xxx                 │   │
│ │                    [编辑] [删除]       │   │
│ └───────────────────────────────────────┘   │
│ Q2. ...                                    │
│                                             │
│ 金币奖励: [___] 枚                          │
│ 截止日期: [日期时间选择]                     │
│                                             │
│              [取消]  [发布作业]              │
└─────────────────────────────────────────────┘
```

### 4.2 学生作答页面（新页面/大弹窗）
```
┌─────────────────────────────────────────────┐
│ 📝 完成作业: xxxxx                    [X]   │
├─────────────────────────────────────────────┤
│ 科目: 数学 | 题目数: 10 | 金币奖励: +30     │
│ 截止: 2025-01-20 23:59                      │
│                                             │
│ ═══ 第 1 题 (单选题) ═══                   │
│ │                                           │
│ │  已知抛物线 y = x² - 4x + 3 的顶点坐标是？│
│ │                                           │
│ │   ○ A. (2, -1)                            │
│ │   ○ B. (2, 1)                             │
│ │   ○ C. (-2, -1)                           │
│ │   ○ D. (-2, 1)                            │
│ ════════════════════════════════════════    │
│                                             │
│ ═══ 第 2 题 (单选题) ═══                   │
│ │ ...                                       │
│ ════════════════════════════════════════    │
│                                             │
│ 进度: ████░░░░░░░ 4/10                     │
│                                             │
│              [取消]  [提交答案]              │
└─────────────────────────────────────────────┘
```

### 4.3 作答结果页面（提交后展示）
```
┌─────────────────────────────────────────────┐
│ ✅ 作答完成!                          [X]   │
├─────────────────────────────────────────────┤
│ 📊 总分: 80/100  |  🪙 获得: +24 金币       │
│                                             │
│ ─── 答题详情 ───                            │
│                                             │
│ Q1. 抛物线顶点...                    ✅ 正确 │
│    你的答案: A  |  正确答案: A               │
│    解析: 通过配方法...                       │
│                                             │
│ Q2. 函数定义域...                    ❌ 错误 │
│    你的答案: C  |  正确答案: B               │
│    解析: 定义域要求x+1≠0...                  │
│    [🔄 再做一题]                             │
│                                             │
│ Q3. ...                              ✅ 正确 │
│                                             │
│ ❌ 错题: 2 道  |  [📖 加入错题本]           │
│                                             │
│                        [查看详细报告] [关闭] │
└─────────────────────────────────────────────┘
```

### 4.4 主观题提交页面
```
┌─────────────────────────────────────────────┐
│ 📝 主观题作答: xxxxx                  [X]   │
├─────────────────────────────────────────────┤
│ ⚠️ 注意：主观题仅有一次提交机会！            │
│                                             │
│ ═══ 第 1 题 (简答题) ═══                   │
│ │ 请简述二次函数图像的性质                   │
│ │                                           │
│ │ ┌─────────────────────────────────────┐  │
│ │ │ 在此输入你的答案...                   │  │
│ │ │                                     │  │
│ │ │                                     │  │
│ │ └─────────────────────────────────────┘  │
│ │                                           │
│ │ 📷 上传作答图片:                          │
│ │   [📤 点击上传图片]  已选择: 无           │
│ ════════════════════════════════════════    │
│                                             │
│              [取消]  [确认提交]              │
└─────────────────────────────────────────────┘
```

### 4.5 教师统计面板
```
┌─────────────────────────────────────────────┐
│ 📊 作业统计: xxxxx                    [X]   │
├─────────────────────────────────────────────┤
│ 基本数据                                     │
│ 全班人数: 40  |  已提交: 35  |  完成率: 87.5%│
│ 平均分: 78.5  |  最高分: 100  |  最低分: 45  │
│                                             │
│ 各题正确率                                   │
│ Q1 ████████████████████  90%                │
│ Q2 ██████████████      65%  ← 需要关注      │
│ Q3 █████████████████   82%                  │
│                                             │
│ 学生明细                                     │
│ 排名 | 姓名   | 分数 | 提交时间 | 操作       │
│  1  | 张三   | 100  | 01-19  | [查看]       │
│  2  | 李四   | 95   | 01-19  | [查看]       │
│ ...                                        │
│                                             │
│              [导出报表]  [关闭]              │
└─────────────────────────────────────────────┘
```

### 4.6 错题本页面
```
┌─────────────────────────────────────────────┐
│ 📖 我的错题本                               │
├─────────────────────────────────────────────┤
│ 筛选: [全部] [数学] [物理] ...  | 搜索: [...]│
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ 数学 | 二次函数 | 错误1次 | 01-19       │ │
│ │ Q: 抛物线y=x²-4x+3的对称轴是？          │ │
│ │ 你的答案: x=-2  |  正确答案: x=2        │ │
│ │ [查看解析] [再做一次] [标记已掌握]       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 统计: 共25道错题 | 已复习18道 | 待复习7道   │
└─────────────────────────────────────────────┘
```

---

## 五、实施任务清单

### Phase 1: 数据库层
- [ ] 1.1 编写数据库迁移脚本（新增5张表+修改2张表）
- [ ] 1.2 测试迁移脚本执行

### Phase 2: 后端API
- [ ] 2.1 重构 assignments.js - AI生成题目接口（支持3倍变体）
- [ ] 2.2 重构 assignments.js - 发布作业接口（关联题目库）
- [ ] 2.3 重构 assignments.js - 获取作业详情（不含答案）
- [ ] 2.4 实现 assignments.js - 提交作业（客观题自动批改）
- [ ] 2.5 实现 assignments.js - 提交作业（主观题图片上传）
- [ ] 2.6 实现 assignments.js - 重新作答接口（变体题替换）
- [ ] 2.7 实现 assignments.js - AI异步评阅主观题
- [ ] 2.8 实现 assignments.js - 统计接口
- [ ] 2.9 新建 upload.js - 图片上传API
- [ ] 2.10 新建/重构 wrong-questions.js - 错题本API

### Phase 3: 前端-教师端
- [ ] 3.1 重构 Assignments.tsx 发布弹窗（AI生成+预览）
- [ ] 3.2 实现题目预览和编辑组件
- [ ] 3.3 实现统计面板组件

### Phase 4: 前端-学生端
- [ ] 4.1 重构 Assignments.tsx 作答页面（展示具体题目）
- [ ] 4.2 实现选择题交互组件（Radio/Checkbox）
- [ ] 4.3 实现简答题文本输入组件
- [ ] 4.4 实现图片上传组件
- [ ] 4.5 实现作答结果展示页
- [ ] 4.6 实现重新作答流程（变体题）

### Phase 5: 错题本功能
- [ ] 5.1 新建 WrongQuestions.tsx 错题本页面
- [ ] 5.2 实现错题列表展示
- [ ] 5.3 实现错题详情和复习功能
- [ ] 5.4 在导航中添加错题本入口

### Phase 6: 集成测试与质量审查
- [ ] 6.1 端到端测试：完整流程走通
- [ ] 6.2 代码质量检查（lint/typecheck）
- [ ] 6.3 边界情况验证
- [ ] 6.4 最终审查 todolist 完成度
