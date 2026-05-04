const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const ALLOWED_SORT_FIELDS = ['error_rate', 'total_answers', 'created_at', 'difficulty', 'usage_count', 'id'];
const ALLOWED_SORT_ORDERS = ['asc', 'desc'];

router.get('/', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      subject,
      type,
      difficulty,
      knowledge_point,
      grade_level,
      source,
      is_public,
      keyword,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize)));
    const offset = (pageNum - 1) * pageSizeNum;

    const safeSortBy = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = ALLOWED_SORT_ORDERS.includes(sortOrder) ? sortOrder : 'desc';

    const conditions = [];
    const params = [];

    if (subject) {
      conditions.push('qb.subject = ?');
      params.push(subject);
    }
    if (type) {
      conditions.push('qb.type = ?');
      params.push(type);
    }
    if (difficulty) {
      conditions.push('qb.difficulty = ?');
      params.push(difficulty);
    }
    if (knowledge_point) {
      conditions.push('qb.knowledge_point LIKE ?');
      params.push(`%${knowledge_point}%`);
    }
    if (grade_level) {
      conditions.push('qb.grade_level = ?');
      params.push(grade_level);
    }
    if (source) {
      conditions.push('qb.source = ?');
      params.push(source);
    }
    if (is_public !== undefined && is_public !== '') {
      conditions.push('qb.is_public = ?');
      params.push(parseInt(is_public));
    }
    if (keyword) {
      conditions.push('qb.content LIKE ?');
      params.push(`%${keyword}%`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    let orderClause;
    if (safeSortBy === 'error_rate') {
      orderClause = `ORDER BY CASE WHEN total_answers > 0 THEN CAST(wrong_answers AS REAL) / total_answers ELSE 0 END ${safeSortOrder}`;
    } else if (safeSortBy === 'total_answers') {
      orderClause = `ORDER BY total_answers ${safeSortOrder}`;
    } else if (safeSortBy === 'difficulty') {
      orderClause = `ORDER BY CASE qb.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 ELSE 4 END ${safeSortOrder}`;
    } else {
      orderClause = `ORDER BY qb.${safeSortBy} ${safeSortOrder}`;
    }

    const countSql = `
      SELECT COUNT(*) as total FROM question_bank qb
      ${whereClause}
    `;
    const { total } = db.prepare(countSql).get(...params);

    const dataSql = `
      SELECT
        qb.*,
        COUNT(qa.id) as total_answers,
        SUM(CASE WHEN qa.is_correct = 0 THEN 1 ELSE 0 END) as wrong_answers,
        CASE WHEN COUNT(qa.id) > 0
          THEN ROUND(CAST(SUM(CASE WHEN qa.is_correct = 0 THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(qa.id), 1)
          ELSE 0
        END as error_rate,
        u.username as creator_name
      FROM question_bank qb
      LEFT JOIN question_answers qa ON qb.id = qa.question_bank_id
      LEFT JOIN users u ON qb.created_by = u.id
      ${whereClause}
      GROUP BY qb.id
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    const questions = db.prepare(dataSql).all(...params, pageSizeNum, offset);

    for (const q of questions) {
      if (q.options) {
        try { q.options = JSON.parse(q.options); } catch (e) { }
      }
      if (q.tags) {
        try { q.tags = JSON.parse(q.tags); } catch (e) { }
      }
    }

    const subjects = db.prepare('SELECT DISTINCT subject FROM question_bank ORDER BY subject').all().map(r => r.subject);
    const types = db.prepare('SELECT DISTINCT type FROM question_bank ORDER BY type').all().map(r => r.type);
    const gradeLevels = db.prepare('SELECT DISTINCT grade_level FROM question_bank WHERE grade_level IS NOT NULL ORDER BY grade_level').all().map(r => r.grade_level);

    res.json({
      questions,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
      filters: { subjects, types, gradeLevels },
    });
  } catch (error) {
    console.error('获取题库列表失败:', error);
    res.status(500).json({ error: '获取题库列表失败: ' + error.message });
  }
});

router.get('/:id', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const question = db.prepare(`
      SELECT
        qb.*,
        COUNT(qa.id) as total_answers,
        SUM(CASE WHEN qa.is_correct = 0 THEN 1 ELSE 0 END) as wrong_answers,
        CASE WHEN COUNT(qa.id) > 0
          THEN ROUND(CAST(SUM(CASE WHEN qa.is_correct = 0 THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(qa.id), 1)
          ELSE 0
        END as error_rate,
        u.username as creator_name
      FROM question_bank qb
      LEFT JOIN question_answers qa ON qb.id = qa.question_bank_id
      LEFT JOIN users u ON qb.created_by = u.id
      WHERE qb.id = ?
      GROUP BY qb.id
    `).get(req.params.id);

    if (!question) return res.status(404).json({ error: '题目不存在' });

    if (question.options) {
      try { question.options = JSON.parse(question.options); } catch (e) { }
    }
    if (question.tags) {
      try { question.tags = JSON.parse(question.tags); } catch (e) { }
    }

    res.json({ question });
  } catch (error) {
    console.error('获取题目详情失败:', error);
    res.status(500).json({ error: '获取题目详情失败: ' + error.message });
  }
});

module.exports = router;
