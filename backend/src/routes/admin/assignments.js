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

router.get('/assignments', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_homework_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看作业记录' });
    }

    let sql = `
      SELECT a.*,
        COALESCE(u.real_name, u.username) as creator_name,
        c.name as class_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (userRole === 'teacher') {
        const setting = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('perm_homework_records');
        const permLevel = setting?.value || 'subject_teacher';
        if (permLevel === 'subject_teacher') {
          if (perm.classIds.length > 0) {
            const placeholders = perm.classIds.map(() => '?').join(',');
            sql += ` AND (a.teacher_id = ? OR a.class_id IN (${placeholders}))`;
            params.push(userId, ...perm.classIds);
          } else {
            sql += ` AND a.teacher_id = ?`;
            params.push(userId);
          }
        } else {
          if (perm.classIds.length > 0) {
            const placeholders = perm.classIds.map(() => '?').join(',');
            sql += ` AND a.class_id IN (${placeholders})`;
            params.push(...perm.classIds);
          } else {
            sql += ` AND 1=0`;
          }
        }
      }
    }

    if (class_id) {
      sql += ` AND a.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY a.created_at DESC LIMIT 100`;

    const assignments = db.prepare(sql).all(...params);
    res.json({ assignments });
  } catch (error) {
    console.error('获取作业列表失败:', error);
    res.status(500).json({ error: '获取作业列表失败' });
  }
});

router.delete('/assignments/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const assignmentId = parseInt(req.params.id);
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const questionIds = db.prepare('SELECT question_bank_id FROM assignment_questions WHERE assignment_id = ?').all(assignmentId).map(q => q.question_bank_id);
    // 提交 ID 必须在事务外先取：事务回调内声明的变量在回调外不可见，否则响应构造阶段会抛 ReferenceError
    const submissionIds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ?').all(assignmentId).map(s => s.id);

    const deleteAll = db.transaction(() => {
      for (const qid of questionIds) {
        const qaIds = db.prepare('SELECT id FROM question_answers WHERE question_bank_id = ?').all(qid).map(qa => qa.id);
        if (qaIds.length > 0) {
          const qaPlaceholders = qaIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM question_answers WHERE id IN (${qaPlaceholders})`).run(...qaIds);
        }
        db.prepare('DELETE FROM wrong_questions WHERE question_id = ?').run(qid);
        db.prepare('DELETE FROM knowledge_point_stats WHERE knowledge_point = (SELECT knowledge_point FROM question_bank WHERE id = ?)').run(qid);
      }

      if (submissionIds.length > 0) {
        const subPlaceholders = submissionIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM question_answers WHERE submission_id IN (${subPlaceholders})`).run(...submissionIds);
        db.prepare(`DELETE FROM submissions WHERE assignment_id = ?`).run(assignmentId);
      }

      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ?').run(assignmentId);
      db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);

      for (const qid of questionIds) {
        db.prepare('DELETE FROM question_bank WHERE id = ?').run(qid);
      }
    });

    deleteAll();

    res.json({
      message: '作业及相关数据已彻底删除',
      deleted: {
        assignment_id: assignmentId,
        questions_deleted: questionIds.length,
        submissions_deleted: submissionIds.length
      }
    });
  } catch (error) {
    console.error('删除作业错误:', error);
    res.status(500).json({ error: '删除作业失败: ' + error.message });
  }
});

router.delete('/assignments/:assignmentId/questions/:questionId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const assignmentId = parseInt(req.params.assignmentId);
    const questionId = parseInt(req.params.questionId);

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const aq = db.prepare('SELECT * FROM assignment_questions WHERE assignment_id = ? AND question_bank_id = ?').get(assignmentId, questionId);
    if (!aq) return res.status(404).json({ error: '该题目不在此作业中' });

    const deleteQuestion = db.transaction(() => {
      const qaIds = db.prepare('SELECT id FROM question_answers WHERE question_bank_id = ?').all(questionId).map(qa => qa.id);
      if (qaIds.length > 0) {
        const qaPlaceholders = qaIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM question_answers WHERE id IN (${qaPlaceholders})`).run(...qaIds);
      }

      db.prepare('DELETE FROM wrong_questions WHERE question_id = ?').run(questionId);

      const kp = db.prepare('SELECT knowledge_point FROM question_bank WHERE id = ?').get(questionId);
      if (kp && kp.knowledge_point) {
        db.prepare('DELETE FROM knowledge_point_stats WHERE knowledge_point = ?').run(kp.knowledge_point);
      }

      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ? AND question_bank_id = ?').run(assignmentId, questionId);
      db.prepare('DELETE FROM question_bank WHERE id = ?').run(questionId);
    });

    deleteQuestion();

    res.json({ message: '题目及相关记录已删除', deleted_question_id: questionId });
  } catch (error) {
    console.error('删除题目错误:', error);
    res.status(500).json({ error: '删除题目失败: ' + error.message });
  }
});

module.exports = router;
