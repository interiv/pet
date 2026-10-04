const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { recordGoldChange, recordItemChange } = require('../services/rewards');

// 宠物技能槽上限
const MAX_SKILL_SLOTS = 4;

// 已占用的技能槽
function usedSkillSlots(petId) {
  return db.prepare('SELECT slot FROM pet_skills WHERE pet_id = ?').all(petId)
    .map((r) => r.slot)
    .filter((s) => Number.isInteger(s));
}

function countPetSkills(petId) {
  return db.prepare('SELECT COUNT(*) as c FROM pet_skills WHERE pet_id = ?').get(petId)?.c || 0;
}

// 分配技能槽：取 1..MAX_SKILL_SLOTS 中最小的空位。
// 原先 pets.js 用「已有数量 + 1」，遗忘中间槽位后再学会产生重复槽号。
function allocateSkillSlot(petId) {
  const used = usedSkillSlots(petId);
  for (let i = 1; i <= MAX_SKILL_SLOTS; i++) {
    if (!used.includes(i)) return i;
  }
  return null;
}

// 获取所有可用技能
router.get('/available', authenticateToken, (req, res) => {
  try {
    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 获取所有技能
    const allSkills = db.prepare('SELECT * FROM skills ORDER BY required_level').all();

    // 获取用户已学习的技能
    const learnedSkills = db.prepare(`
      SELECT ps.*, s.name, s.description, s.icon, s.skill_type, s.subject
      FROM pet_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.pet_id = ?
    `).all(pet.id);

    const learnedMap = new Map(learnedSkills.map((s) => [s.skill_id, s]));

    // 检查每个技能是否可学习
    const skills = allSkills.map(skill => {
      const learned = learnedMap.get(skill.id) || null;
      const isLearned = !!learned;

      // 检查解锁条件：等级 + 知识点掌握度 + 该学科正确率（seeds 里定义的门槛）
      let lockReason = '';
      if (pet.level < (skill.required_level || 1)) {
        lockReason = `需要宠物达到 ${skill.required_level} 级`;
      } else if (skill.required_knowledge_point) {
        // knowledge_point_stats 用 accuracy（0~1）表示掌握度
        const kp = db.prepare(
          `SELECT AVG(accuracy) AS acc, SUM(total_attempts) AS attempts
             FROM knowledge_point_stats
            WHERE user_id = ? AND knowledge_point = ?`
        ).get(req.user.userId, skill.required_knowledge_point);
        const attempts = kp && kp.attempts ? kp.attempts : 0;
        const acc = kp && kp.acc != null ? kp.acc : 0;
        if (attempts === 0 || acc < 0.6) {
          lockReason = `需要掌握知识点「${skill.required_knowledge_point}」（正确率 60%）`;
        }
      } else if (skill.required_accuracy) {
        // question_answers 没有 subject 列，需经 submissions 关联
        const params = skill.subject ? [req.user.userId, skill.subject] : [req.user.userId];
        const acc = db.prepare(
          `SELECT AVG(CASE WHEN qa.is_correct = 1 THEN 1.0 ELSE 0 END) AS rate
             FROM question_answers qa
             JOIN submissions s ON s.id = qa.submission_id
            WHERE s.user_id = ? ${skill.subject ? 'AND s.assignment_id IN (SELECT id FROM assignments WHERE subject = ?)' : ''}`
        ).get(...params);
        const rate = acc && acc.rate != null ? acc.rate : 0;
        if (rate < skill.required_accuracy) {
          lockReason = `需要${skill.subject || '该学科'}正确率达到 ${Math.round(skill.required_accuracy * 100)}%`;
        }
      }

      const canUnlock = !isLearned && !lockReason;

      return {
        ...skill,
        isLearned,
        canUnlock,
        lockReason,
        locked: !isLearned && !canUnlock,
        // 已学习的技能要带上 pet_skills 的等级/精通度/使用次数，
        // 否则前端会显示 Lv.undefined、精通度恒为 0%
        level: learned ? learned.level : 0,
        mastery: learned ? learned.mastery : 0,
        use_count: learned ? learned.use_count : 0,
        learned_at: learned ? learned.learned_at : null,
      };
    });

    res.json({
      skills,
      learnedCount: learnedSkills.length,
      pet: {
        id: pet.id,
        name: pet.name,
        level: pet.level
      }
    });
  } catch (error) {
    console.error('获取技能列表失败:', error);
    res.status(500).json({ error: '获取技能列表失败' });
  }
});

// 学习技能
router.post('/learn', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill_id);
    if (!skill) {
      return res.status(404).json({ error: '技能不存在' });
    }

    // 检查是否已学习
    const existing = db.prepare('SELECT id FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (existing) {
      return res.status(400).json({ error: '已学习该技能' });
    }

    // 检查解锁条件
    if (pet.level < skill.required_level) {
      return res.status(400).json({ error: `宠物等级不足，需要等级 ${skill.required_level}` });
    }

    // 技能槽上限校验（原先本接口完全没有校验，可无限学技能）
    const slot = allocateSkillSlot(pet.id);
    if (slot === null) {
      return res.status(400).json({ error: `技能槽已满（最多 ${MAX_SKILL_SLOTS} 个），请先遗忘一个技能` });
    }

    db.prepare(`
      INSERT INTO pet_skills (pet_id, skill_id, slot, level, mastery)
      VALUES (?, ?, ?, 1, 0)
    `).run(pet.id, skill_id, slot);

    res.json({
      message: `成功学习技能: ${skill.name}`,
      skill
    });
  } catch (error) {
    console.error('学习技能失败:', error);
    res.status(500).json({ error: '学习技能失败' });
  }
});

// 升级技能
router.post('/upgrade', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const petSkill = db.prepare('SELECT * FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (!petSkill) {
      return res.status(404).json({ error: '未学习该技能' });
    }

    if (petSkill.level >= 10) {
      return res.status(400).json({ error: '技能已达最高等级' });
    }

    // 升级需要消耗金币
    const goldCost = petSkill.level * 50;
    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    
    if (user.gold < goldCost) {
      return res.status(400).json({ error: `金币不足，需要 ${goldCost} 金币` });
    }

    // 扣除金币并升级技能
    db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(goldCost, req.user.userId);
    const skillName = (db.prepare('SELECT name FROM skills WHERE id = ?').get(skill_id) || {}).name || `技能#${skill_id}`;
    recordGoldChange(req.user.userId, -goldCost, `升级技能：${skillName} Lv.${petSkill.level}`, 'upgrade_skill');
    db.prepare('UPDATE pet_skills SET level = level + 1 WHERE id = ?').run(petSkill.id);

    const updatedPetSkill = db.prepare('SELECT * FROM pet_skills WHERE id = ?').get(petSkill.id);
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill_id);

    res.json({
      message: `技能升级成功: ${skill.name} Lv.${updatedPetSkill.level}`,
      skill: updatedPetSkill,
      goldCost
    });
  } catch (error) {
    console.error('升级技能失败:', error);
    res.status(500).json({ error: '升级技能失败' });
  }
});

// 使用技能（在战斗中）
router.post('/use', authenticateToken, (req, res) => {
  try {
    // battle_id 目前未参与任何校验（原实现接收后即丢弃），保留仅为兼容旧前端传参
    const { skill_id, battle_id: _battleId } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 显式列出字段并给 skills 的同名列加别名。
    // 原先写 SELECT ps.*, s.* ，s.* 会覆盖 ps.id / ps.level，
    // 导致下面 UPDATE pet_skills WHERE id = ? 用到的是 skills 表的 id，改到别的记录上。
    const petSkill = db.prepare(`
      SELECT
        ps.id            AS pet_skill_id,
        ps.pet_id        AS pet_id,
        ps.skill_id      AS skill_id,
        ps.level         AS pet_skill_level,
        ps.mastery       AS mastery,
        ps.use_count     AS use_count,
        ps.last_used     AS last_used,
        s.id             AS skill_row_id,
        s.name           AS name,
        s.description    AS description,
        s.icon           AS icon,
        s.skill_type     AS skill_type,
        s.subject        AS subject,
        s.required_level AS required_level,
        s.cooldown       AS cooldown,
        s.base_damage    AS base_damage,
        s.base_defense   AS base_defense,
        s.base_speed     AS base_speed
      FROM pet_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.pet_id = ? AND ps.skill_id = ?
    `).get(pet.id, skill_id);

    if (!petSkill) {
      return res.status(404).json({ error: '未学习该技能' });
    }

    // 检查冷却时间（简化处理）
    if (petSkill.last_used) {
      const lastUsed = new Date(petSkill.last_used);
      const now = new Date();
      const hoursSinceLastUse = (now - lastUsed) / (1000 * 60 * 60);
      
      if (hoursSinceLastUse < petSkill.cooldown) {
        return res.status(400).json({ 
          error: `技能冷却中，还需等待 ${Math.ceil(petSkill.cooldown - hoursSinceLastUse)} 小时` 
        });
      }
    }

    // 使用技能（注意用别名后的 pet_skill_id，避免误用 skills 表 id）
    db.prepare(`
      UPDATE pet_skills 
      SET last_used = CURRENT_TIMESTAMP, use_count = use_count + 1, mastery = mastery + 1
      WHERE id = ?
    `).run(petSkill.pet_skill_id);

    // 计算技能效果（用宠物自身技能等级，而非技能模板等级）
    const levelBonus = petSkill.pet_skill_level * 0.1;
    const effect = {
      damage: Math.round(petSkill.base_damage * (1 + levelBonus)),
      defense: Math.round(petSkill.base_defense * (1 + levelBonus)),
      speed: Math.round(petSkill.base_speed * (1 + levelBonus))
    };

    res.json({
      message: `使用了技能: ${petSkill.name}`,
      skill: petSkill.name,
      icon: petSkill.icon,
      effect,
      mastery: petSkill.mastery + 1
    });
  } catch (error) {
    console.error('使用技能失败:', error);
    res.status(500).json({ error: '使用技能失败' });
  }
});

module.exports = router;
module.exports.MAX_SKILL_SLOTS = MAX_SKILL_SLOTS;
module.exports.allocateSkillSlot = allocateSkillSlot;
module.exports.countPetSkills = countPetSkills;

// ============================================================
// Skill 安装文档托管（供「一句话安装」用，不走鉴权）
// ============================================================
//
// 做法参考 SkillHub：给用户一句自然语言指令，其中带一个公网 .md 地址，
// AI 助手自己抓取该地址、读完里面的步骤，然后自行完成安装——
// 用户不需要手动下载文件再上传给 Agent。
//
// 与 SkillHub 的差别：SkillHub 的 skill 是公共的，地址里不带凭证；
// 而本文件含有教师本人的身份令牌（否则 AI 拿不到写入权限），
// 所以地址必须带 token。该token 本就是可随时吊销的凭证，泄露风险可控。

const SKILL_INSTALL_SLUG = 'classroom-quiz';
const { hashToken } = require('../middleware/agentAuth');

// 常见 AI 客户端的 skills 目录，避免 Agent 装错位置
const AGENT_SKILL_DIRS = [
  { name: 'WorkBuddy', dir: '~/.workbuddy/skills/' },
  { name: 'Claude Code', dir: '~/.claude/skills/' },
  { name: 'Codex', dir: '~/.codex/skills/' },
  { name: 'Cursor', dir: '~/.cursor/skills/' },
  { name: 'Gemini CLI', dir: '~/.gemini/skills/' },
  { name: 'Windsurf', dir: '~/.codeium/windsurf/skills/' },
];

function resolveAgentToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token || token.length < 16) return null;
  const row = db.prepare(
    `SELECT t.id, t.user_id, t.revoked_at, u.username, u.real_name, u.role
       FROM agent_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?`
  ).get(hashToken(token));
  if (!row || row.revoked_at) return null;
  // 令牌只对教师/管理员有意义，学生拿它也写不了题目
  if (!['teacher', 'admin'].includes(row.role)) return null;
  return row;
}

function describeTeachingClasses(userId) {
  const rows = db.prepare(
    `SELECT c.id, c.name, ct.role, ct.subject
       FROM class_teachers ct JOIN classes c ON c.id = ct.class_id
      WHERE ct.teacher_id = ? ORDER BY c.id`
  ).all(userId);
  if (rows.length === 0) {
    return '- （该老师还没有任教任何班级。请先在系统「个人中心 → 任教信息」申请，或由管理员分配后再提交题目）';
  }
  return rows.map((r) => {
    const role = r.role === 'head_teacher' ? '班主任' : '任课教师';
    const subject = r.subject ? ` · ${r.subject}` : '';
    return `- \`class_id=${r.id}\` ${r.name}（${role}${subject}）`;
  }).join('\n');
}

function defaultSubjectOf(userId) {
  const row = db.prepare(
    `SELECT ct.subject FROM class_teachers ct
      WHERE ct.teacher_id = ? AND ct.subject IS NOT NULL AND TRIM(ct.subject) <> ''
      ORDER BY ct.role = 'head_teacher' DESC, ct.id LIMIT 1`
  ).get(userId);
  return (row && row.subject) || '';
}

/**
 * GET /api/skills/install/:slug?token=xxx
 * 直接返回 markdown。AI 助手抓到这个地址就等于拿到全部接入说明。
 */
router.get('/install/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').replace(/\.md$/i, '');
    if (slug !== SKILL_INSTALL_SLUG) {
      return res.status(404).type('text/plain; charset=utf-8')
        .send(`# 未找到该 Skill\n\n当前可用：\`${SKILL_INSTALL_SLUG}\`\n`);
    }

    // token 放query 或 Authorization 头都行（有些 Agent 抓取时不方便带 query）
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = String(req.query.token || bearer || '').trim();

    const owner = resolveAgentToken(token);
    if (!owner) {
      return res.status(401).type('text/plain; charset=utf-8').send(
        '# 令牌无效或已被吊销\n\n' +
        '请让老师在「课堂做题 → 创建 → AI 工具录入 → 方式一」重新生成令牌，再用新链接安装。\n'
      );
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const apiRoot = `${baseUrl}/api/agent`;
    const subject = defaultSubjectOf(owner.user_id) || '数学';
    const dirHints = AGENT_SKILL_DIRS
      .map((d) => `  - ${d.name}：\`${d.dir}${SKILL_INSTALL_SLUG}/SKILL.md\``)
      .join('\n');
    const teacherName = owner.real_name || owner.username;

    const doc = `# 课堂做题题目生成 · AI 直连接入（课堂宠物养成系统）

> 本文件由系统自动生成，**内含老师的身份令牌，请勿外传、不要提交到公开仓库**。
> 老师随时可在「课堂做题 → 创建 → AI 工具录入」重新生成或吊销令牌。

## 你要做什么

你可以**直接调用后端接口，把题目写进老师的「课堂做题」**，不需要把题目以文本形式交回给老师。

## 接入信息（已配好，直接用）
- 接口根地址：\`${apiRoot}\`
- 身份令牌：\`${token}\`
- 鉴权方式：所有请求都要带头 \`X-Agent-Token: ${token}\`
  （也兼容 \`Authorization: Bearer ${token}\`）
- 请求/响应均为 \`application/json\`，UTF-8
- 当前代表老师：${teacherName}

## 可写入的班级

提交题目时必须指定 \`class_id\`，且只能选下面这些：

${describeTeachingClasses(owner.user_id)}

## 第一步：确认身份

\`\`\`bash
curl ${apiRoot}/whoami -H "X-Agent-Token: ${token}"
\`\`\`

返回要点：
- \`teacher\`：你当前代表的老师
- \`classes\`：可写入的班级（\`role\` 为 head_teacher / teacher，\`subject\` 为该班任教科目）
- \`default_subject\`：提交时 subject 默认用这个值（当前：**${subject}**），除非老师明确要求换科目
- \`default_class_id\`：老师只带一个班时可直接用；带多个班时**必须先问老师用哪个班**

## 接口清单

| 需求 | 请求 |
| --- | --- |
| 出题并直接创建课堂做题 | \`POST ${apiRoot}/classroom-quizzes\` |
| 给已有课堂做题补题 | \`POST ${apiRoot}/classroom-quizzes/{quiz_id}/questions\` |
| 只预检不落库 | 上面两个接口体里加 \`"dry_run": true\` |
| 查已有课堂做题 | \`GET ${apiRoot}/classroom-quizzes\` |
| 看某场做题详情 | \`GET ${apiRoot}/classroom-quizzes/{quiz_id}\` |
| 复用题库现成题 | \`GET ${apiRoot}/question-bank?subject=数学&keyword=分数\` |
| 读接口自述 | \`GET ${apiRoot}/\` |

## 提交格式

\`\`\`json
{
  "title": "分数加减法随堂练习",
  "subject": "${subject}",
  "class_id": 7,
  "description": "课堂抢答，答对发宠物道具",
  "questions": [
    { "question_text": "一个三角形有几个角？", "answer_text": "3 个" },
    { "question_text": "计算 1/2 + 1/3 = ?", "answer_text": "5/6", "courseware_html": "<!DOCTYPE html>...</html>" }
  ]
}
\`\`\`

字段说明：
- \`question_text\` **必填**，最长 2000 字
- \`answer_text\` 可选，参考答案，只给老师看
- \`courseware_html\` **可选**：完整独立的 HTML 文档（以 \`<!DOCTYPE html>\` 开头），上限 200KB
  - 必须离线可用：样式与脚本写在同一个 HTML 里，**不要引用外部网络资源**
  - 可以放图示、动画、可点/可拖的小实验：学生先操作课件、思考，再回到题目作答
  - **课件不是必须的**，没有也能正常提交

## 推荐工作流程

1. 先 \`GET /whoami\` 拿到身份、班级、任教科目
2. 老师想先看 → 用 \`"dry_run": true\` 预检，把要提交的内容复述给老师确认
3. 确认后正式 \`POST /classroom-quizzes\`，拿到 \`quiz_id\`
4. 需要补题 → \`POST /classroom-quizzes/{quiz_id}/questions\`
5. 提交成功后告诉老师：「已创建第 N 场课堂做题，共 X 道题，其中 Y 道带课件」

## 示例（curl）

\`\`\`bash
curl -X POST ${apiRoot}/classroom-quizzes \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Token: ${token}" \\
  -d '{
    "title": "分数加减法随堂练习",
    "subject": "${subject}",
    "questions": [
      { "question_text": "1/2 + 1/3 = ?", "answer_text": "5/6",
        "courseware_html": "<!DOCTYPE html><html><body><h1>课件</h1></body></html>" }
    ]
  }'
\`\`\`

## 把本能力安装为本地 Skill（可选）

若你的运行环境支持文件工具，可把本文件存成 \`SKILL.md\`：

${dirHints}

\`\`\`bash
mkdir -p ~/.workbuddy/skills/${SKILL_INSTALL_SLUG}
curl -fsSL "${baseUrl}/api/skills/install/${SKILL_INSTALL_SLUG}?token=${token}" \\
  -o ~/.workbuddy/skills/${SKILL_INSTALL_SLUG}/SKILL.md
\`\`\`

（把目录换成你实际使用的客户端。安装后若新技能未生效，重启一次助手即可。）

## 约束与注意

- 一次最多 50 道题；建议单次不超过 20 道，超了就分批追加
- 只能写入令牌所属老师任教的班级，写到别的班会返回 403
- 令牌等同老师身份：**不要外传、不要提交到公开仓库**；老师吊销后立即失效
- 令牌失效返回 401（提示 \`令牌无效或已被吊销\`），此时让老师到
  「课堂做题 → 创建 → AI 工具录入」重新生成令牌
- 提交题目**不消耗** AI 生成额度；只有系统内的「AI 出题」功能才消耗
`;

    // 含令牌，绝不能被任何中间缓存存下来
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Referrer-Policy', 'no-referrer');
    res.type('text/markdown; charset=utf-8').send(doc);
  } catch (error) {
    console.error('生成 Skill 安装文档失败:', error);
    res.status(500).type('text/plain; charset=utf-8').send('# 服务暂时不可用，请稍后重试\n');
  }
});
