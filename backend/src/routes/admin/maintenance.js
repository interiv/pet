const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { getChinaDate } = require('../../config/timezone');
const { getAIConfig, isAIConfigured, getAITimeoutMs } = require('../../config/ai');
const { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate } = require('../../config/prompts');
const {
  USERNAME_MAX_LEN,
  AI_USERNAME_BATCH_SIZE,
  requireAdmin,
  purgeUserData,
  applyApplicationToClass,
  approveTeacherPendingApplications,
  checkDataPermission,
  cleanStudentNames,
  findDuplicateNames,
  sanitizeUsername,
  sanitizeSequencePrefix,
  isUsernameTaken,
  ensureUniqueUsername,
  randomPassword,
  parseJSONArray,
  generateUsernamesByAI,
  ensureSettingsTable,
} = require('./_shared');

router.post('/clean-all-data', authenticateToken, requireAdmin, (req, res) => {
  try {
    const cleanAll = db.transaction(() => {
      const adminUser = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
      if (!adminUser) {
        throw new Error('admin 账号不存在');
      }

      db.prepare(`DELETE FROM forum_favorites`).run();
      db.prepare(`DELETE FROM forum_post_likes`).run();
      db.prepare(`DELETE FROM forum_likes`).run();
      db.prepare(`DELETE FROM forum_posts`).run();
      db.prepare(`DELETE FROM forum_threads`).run();
      db.prepare(`DELETE FROM forum_thread_tags`).run();
      // 注意：forums（论坛板块定义）属于基础配置数据，由 seeds/07_forums.js 维护，
      // 清理业务数据时必须保留，否则论坛功能会永久失去板块（前端承诺"保留系统数据"）。

      db.prepare(`DELETE FROM boss_battle_answers`).run();
      db.prepare(`DELETE FROM boss_battle_rewards`).run();
      db.prepare(`DELETE FROM boss_battle_participants`).run();
      db.prepare(`DELETE FROM boss_battle_questions`).run();
      db.prepare(`DELETE FROM boss_battles`).run();

      db.prepare(`DELETE FROM question_answers`).run();
      db.prepare(`DELETE FROM assignment_questions`).run();
      // wrong_questions / knowledge_point_stats 引用 assignments 与 submissions，
      // 必须先于它们清理，否则外键约束会导致整个清理事务失败（500）
      db.prepare(`DELETE FROM wrong_questions`).run();
      db.prepare(`DELETE FROM knowledge_point_stats`).run();
      db.prepare(`DELETE FROM submissions`).run();
      db.prepare(`DELETE FROM assignments`).run();

      db.prepare(`DELETE FROM battles`).run();

      db.prepare(`DELETE FROM user_equipment`).run();
      db.prepare(`DELETE FROM user_items`).run();

      // 宠物技能依赖 pets，必须先于 pets 清理，否则外键约束失败
      db.prepare(`DELETE FROM pet_skills`).run();

      db.prepare(`DELETE FROM pets`).run();

      // 课堂做题及其奖励/作答记录（依赖 users / classes / pets）
      db.prepare(`DELETE FROM classroom_quiz_rewards`).run();
      db.prepare(`DELETE FROM classroom_quiz_answers`).run();
      db.prepare(`DELETE FROM classroom_quiz_questions`).run();
      db.prepare(`DELETE FROM classroom_quizzes`).run();

      // 兑换记录 → 卡 → 卡批次（依赖 users / classes）
      db.prepare(`DELETE FROM card_redemption_logs`).run();
      db.prepare(`DELETE FROM cards`).run();
      db.prepare(`DELETE FROM card_batches`).run();

      db.prepare(`DELETE FROM user_tasks`).run();
      db.prepare(`DELETE FROM daily_tasks`).run();
      db.prepare(`DELETE FROM daily_task_logs`).run();
      // tasks（每日任务定义）与 achievements（成就定义）属于基础配置数据，
      // 由 seeds/06_tasks.js、seeds/05_achievements.js 维护，清理时必须保留。
      db.prepare(`DELETE FROM user_achievements`).run();

      db.prepare(`DELETE FROM gold_transactions`).run();
      db.prepare(`DELETE FROM user_activities`).run();

      db.prepare(`DELETE FROM post_comments`).run();
      db.prepare(`DELETE FROM post_likes`).run();
      db.prepare(`DELETE FROM posts`).run();

      db.prepare(`DELETE FROM chat_read_status`).run();
      db.prepare(`DELETE FROM chat_messages`).run();

      db.prepare(`DELETE FROM friend_requests`).run();
      db.prepare(`DELETE FROM friends`).run();

      db.prepare(`DELETE FROM notifications`).run();

      db.prepare(`DELETE FROM announcements`).run();

      db.prepare(`DELETE FROM class_invitations`).run();
      db.prepare(`DELETE FROM class_applications`).run();
      db.prepare(`DELETE FROM class_teachers`).run();
      db.prepare(`DELETE FROM classes`).run();

      db.prepare(`DELETE FROM schools`).run();

      // AI 报告依赖 users，必须在清理用户之前删除
      db.prepare(`DELETE FROM ai_reports`).run();

      db.prepare(`DELETE FROM users WHERE id != ?`).run(adminUser.id);

      db.prepare(`DELETE FROM upload_files`).run();

      db.prepare(`DELETE FROM ai_configs`).run();
    });

    cleanAll();

    res.json({ message: '所有数据已清理，仅保留 admin 账号和基础配置数据' });
  } catch (error) {
    console.error('清理数据失败:', error);
    res.status(500).json({ error: `清理数据失败: ${error.message}` });
  }
});

module.exports = router;
