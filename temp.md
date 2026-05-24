## scripts / seeds 与代码之间的错误清单

---

### 错误1: `achievements.js` 查询不存在的表 `friendships`

**文件**: `d:\MyProject\pet\backend\src\routes\achievements.js`  
**行号**: 155  
**当前代码**:
```js
currentValue = db.prepare('SELECT COUNT(*) as c FROM friendships WHERE user_id = ? OR friend_id = ?').get(req.user.userId, req.user.userId)?.c || 0;
```
**错误**: 数据库中没有 `friendships` 表，实际表名是 `friends`。  
**应改为**:
```js
currentValue = db.prepare("SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'active'").get(req.user.userId)?.c || 0;
```
**说明**: `friends` 表有 `user_id` 和 `friend_id` 两个字段，只需查 `user_id` 侧即可（因为好友关系是双向插入的）。

---

### 错误2: `achievements.js` 查询不存在的表 `battle_results`

**文件**: `d:\MyProject\pet\backend\src\routes\achievements.js`  
**行号**: 164-167  
**当前代码**:
```js
case 'win_battle':
  currentValue = db.prepare("SELECT COUNT(*) as c FROM battle_results WHERE winner_id = ?").get(req.user.userId)?.c || 0;
  break;
case 'lose_battle':
  currentValue = db.prepare("SELECT COUNT(*) as c FROM battle_results WHERE loser_id = ?").get(req.user.userId)?.c || 0;
  break;
```
**错误**: 数据库中没有 `battle_results` 表。实际表是 `battles`，且 `winner_id` 关联的是 `pet.id` 而非 `user.id`，也没有 `loser_id` 字段。  
**应改为**:
```js
case 'win_battle':
  currentValue = db.prepare(`
    SELECT COUNT(*) as c FROM battles b
    JOIN pets p ON (b.pet1_id = p.id OR b.pet2_id = p.id)
    WHERE p.user_id = ? AND b.winner_id = p.id
  `).get(req.user.userId)?.c || 0;
  break;
case 'lose_battle':
  currentValue = db.prepare(`
    SELECT COUNT(*) as c FROM battles b
    JOIN pets p ON (b.pet1_id = p.id OR b.pet2_id = p.id)
    WHERE p.user_id = ? AND b.winner_id != p.id
  `).get(req.user.userId)?.c || 0;
  break;
```

---

### 错误3: `achievements.js` 查询 `chat_messages` 使用不存在的字段 `sender_id`

**文件**: `d:\MyProject\pet\backend\src\routes\achievements.js`  
**行号**: 189  
**当前代码**:
```js
case 'send_message':
  currentValue = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE sender_id = ?").get(req.user.userId)?.c || 0;
  break;
```
**错误**: `chat_messages` 表中没有 `sender_id` 字段，实际字段名是 `user_id`。  
**应改为**:
```js
case 'send_message':
  currentValue = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE user_id = ?").get(req.user.userId)?.c || 0;
  break;
```

---

### 错误4: `achievements.js` 中 `collect_equipment` 查错了表

**文件**: `d:\MyProject\pet\backend\src\routes\achievements.js`  
**行号**: 185-186  
**当前代码**:
```js
case 'collect_equipment':
  currentValue = db.prepare("SELECT COUNT(DISTINCT item_id) as c FROM user_items WHERE user_id = ?").get(req.user.userId)?.c || 0;
  break;
```
**错误**: 成就名是"收集装备"，应该查 `user_equipment` 表，而非 `user_items` 表。`user_items` 是物品（粮食、药水等），`user_equipment` 才是装备。  
**应改为**:
```js
case 'collect_equipment':
  currentValue = db.prepare("SELECT COUNT(DISTINCT equipment_id) as c FROM user_equipment WHERE user_id = ?").get(req.user.userId)?.c || 0;
  break;
```

---

### 错误5: `achievementData.js` 成就奖励引用的物品ID与种子数据不匹配

**文件**: `d:\MyProject\pet\backend\scripts\achievementData.js`  

种子数据 `02_items.js` 按插入顺序，物品ID映射如下：
| ID | 物品名 | 类型 |
|----|--------|------|
| 1 | 普通粮食 | food |
| 2 | 高级零食 | food |
| 3 | 特殊料理 | food |
| 4 | 蜜汁烤肉 | food |
| 5 | 黄金苹果 | food |
| 6 | 经验药水 | potion |
| 7 | 超级经验药水 | potion |
| 8 | 治疗药剂 | potion |
| 9 | 大治疗药剂 | potion |
| 10 | 生命果实 | food |
| 11 | 体力药剂 | potion |
| 12 | 大体力药剂 | potion |
| 13 | 活力果实 | food |
| 14 | 心情药水 | potion |
| 15 | 快乐糖果 | food |
| 16 | 彩虹蛋糕 | food |
| 17 | 力量果实 | food |
| 18 | 铁骨果实 | food |
| 19 | 疾风果实 | food |
| 20 | 保护罩 | potion |
| 21 | 力量药水 | potion |
| 22 | 铁壁药水 | potion |
| 23 | 疾风药水 | potion |
| 24 | 狂暴药水 | potion |
| 25 | 幸运草 | potion |
| 26 | 改名卡 | potion |
| 27 | 转生丹 | potion |
| 28 | 经验加倍卡 | potion |
| 29 | 万灵药 | potion |
| 30 | 营养套餐 | food |
| 31 | 满汉全席 | food |
| 32 | 灵丹妙药 | potion |

成就数据中 `reward_type='item'` 的条目，`reward_value` 应为 items 表的 ID。以下条目有问题：

| sort_order | 成就名 | 当前 reward_value | 当前对应物品 | 应改为 | 建议对应物品 |
|------------|--------|-------------------|-------------|--------|-------------|
| 7 | 一方霸主 | 10 | 生命果实 | 9 | 大治疗药剂 |
| 22 | 身经百战 | 10 | 生命果实 | 9 | 大治疗药剂 |
| 25 | 连胜达人 | 17 | 力量果实 | 9 | 大治疗药剂 |
| 28 | 越挫越勇 | 16 | 彩虹蛋糕 | 12 | 大体力药剂 |
| 11 | 天下无敌 | 24 | 狂暴药水 | 27 | 转生丹 |
| 13 | 神话降临 | 24 | 狂暴药水 | 29 | 万灵药 |

**说明**: 原注释声称 `10=某装备`、`16=某药剂`、`24=某装备`，但实际 ID 对应的物品完全不是那些东西。需要根据游戏设计意图重新选择合适的物品 ID。

---

### 错误6: `achievementData.js` 顶部注释中的物品ID映射完全错误

**文件**: `d:\MyProject\pet\backend\scripts\achievementData.js`  
**行号**: 8-13  
**当前注释**:
```
 *   1=普通粮食(hunger+20,10金) 2=高级零食(hunger+50,50金) 3=特殊料理(hunger+80,100金)
 *   8=快乐糖果(mood+50,50金) 13=经验药水(exp+200,200金) 14=超级经验药水(exp+500,500金)
 *   17=大治疗药剂(health+100,100金) 19=大体力药剂(stamina+100,100金)
 *   27=转生丹(1000金) 28=经验加倍卡(300金) 30=营养套餐(hunger+60,80金)
```
**实际映射**:
```
 *   1=普通粮食(hunger+20,10金) 2=高级零食(hunger+50,50金) 3=特殊料理(hunger+80,100金)
 *   8=治疗药剂(health+50,50金) 13=活力果实(stamina+100,80金) 14=心情药水(mood+30,30金)
 *   17=力量果实(attack+1,500金) 19=疾风果实(speed+1,500金)
 *   27=转生丹(1000金) 28=经验加倍卡(300金) 30=营养套餐(hunger+60,80金)
```
**应改为**: 按上方的实际映射更新注释，或者更好的做法是直接列出完整 ID 映射表（见错误5中的表格）。

---

### 错误7: `06_tasks.js` 种子任务与 `daily-tasks.js` 路由代码完全脱节

**文件1**: `d:\MyProject\pet\backend\seeds\06_tasks.js` — 种子写入 `tasks` 表  
**文件2**: `d:\MyProject\pet\backend\src\routes\daily-tasks.js` — 路由代码  

**种子定义的任务类型**:
- `login` (每日签到)
- `submit_assignment` (完成作业)
- `battle` (进行战斗)
- `visit_friends` (拜访好友)
- `win_battle` (周任务-战斗)

**路由代码实际使用的任务类型**（硬编码在 `daily-tasks.js` 第69-75行）:
- `login` (登录)
- `complete_assignment` (完成作业)
- `feed_pet` (投喂宠物)
- `correct_rate` (正确率达标)
- `review_weak_point` (复习错题)

**问题**: 
1. 路由代码从不读取 `tasks` 表，而是在 `daily_task_logs` 表中硬编码创建任务
2. 任务类型名称不一致：种子用 `submit_assignment`，代码用 `complete_assignment`
3. 种子中的 `battle`、`visit_friends`、`win_battle` 在代码中完全不存在
4. 代码中的 `feed_pet`、`correct_rate`、`review_weak_point` 在种子中不存在

**修复方案（二选一）**:
- **方案A**: 修改 `06_tasks.js` 种子，使其与路由代码一致（任务类型改为 `login`、`complete_assignment`、`feed_pet`、`correct_rate`、`review_weak_point`）
- **方案B**: 既然路由代码不读 `tasks` 表，可以删除 `06_tasks.js` 种子文件，并从 `knexfile` 的 seeds 目录中移除

---

### 错误8: `09_test_data.js` 中2班科任教师索引有误

**文件**: `d:\MyProject\pet\backend\seeds\09_test_data.js`  
**行号**: 120  
**当前代码**:
```js
const class2TeacherIndices = [0, 4, 5, 6, 7, 8];
```
**打印信息**:
```
2班: teacher2(班主任), teacher1,5,6,7,8,9(科任)
```
**问题**: `teacherIds[0]` = teacher1，teacher1 已经是1班班主任，同时作为2班科任教师。而打印信息说科任是 `teacher1,5,6,7,8,9`，但索引 `[0,4,5,6,7,8]` 对应的是 `teacher1,5,6,7,8,9`（teacherIds[4]=teacher5, ..., teacherIds[8]=teacher9），所以打印信息和代码其实是一致的。但 teacher1 作为1班班主任又做2班科任，逻辑上不太合理。

**建议改为**:
```js
const class2TeacherIndices = [2, 4, 5, 6, 7, 8];  // teacher3,5,6,7,8,9
```
同时更新打印信息。

---

### 错误9: `verify_db.js` 使用硬编码相对路径

**文件**: `d:\MyProject\pet\backend\scripts\verify_db.js`  
**行号**: 1  
**当前代码**:
```js
const db = require('better-sqlite3')('./data/database.sqlite');
```
**问题**: 如果不从 `backend/` 目录运行此脚本，路径会解析失败。  
**应改为**:
```js
const path = require('path');
const db = require('better-sqlite3')(path.join(__dirname, '..', 'data', 'database.sqlite'));
```

---

### 汇总

| 编号 | 严重度 | 文件 | 简述 |
|------|--------|------|------|
| 1 | **高** | achievements.js:155 | 表名 `friendships` → 应为 `friends` |
| 2 | **高** | achievements.js:164-167 | 表名 `battle_results` 不存在，需改用 `battles` 表联查 |
| 3 | **高** | achievements.js:189 | 字段名 `sender_id` → 应为 `user_id` |
| 4 | **高** | achievements.js:185-186 | `collect_equipment` 查 `user_items` → 应查 `user_equipment` |
| 5 | **高** | achievementData.js | 成就奖励物品ID 10/16/17/24 与实际物品不匹配 |
| 6 | **高** | achievementData.js:8-13 | 注释中物品ID映射完全错误 |
| 7 | **高** | 06_tasks.js + daily-tasks.js | 种子任务类型与代码完全脱节 |
| 8 | **中** | 09_test_data.js:120 | 2班科任包含1班班主任teacher1，逻辑不合理 |
| 9 | **低** | verify_db.js:1 | 数据库路径硬编码，应改为 `path.join(__dirname, ..)` |