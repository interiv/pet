const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const axios = require('axios');
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

router.get('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
    if (!hasTable) {
      db.prepare(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_model', 'gpt-3.5-turbo')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_api_key', '')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_base_url', 'https://api.openai.com/v1')`).run();
    }
    
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    // 只写不读：不暴露 API Key 到前端
    if (result.ai_api_key && result.ai_api_key.length > 0) {
      result.ai_api_key = '***';
    }
    res.json({ settings: result });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

router.post('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { ai_model, ai_api_key, ai_base_url, ai_report_interval_days, ai_timeout, ai_vision_model } = req.body;

    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      if (ai_model !== undefined) stmt.run('ai_model', ai_model);
      // API Key 只写不读：仅在用户明确提供真实值时更新
      if (ai_api_key !== undefined && ai_api_key !== '' && ai_api_key !== '***') {
        stmt.run('ai_api_key', ai_api_key);
      }
      if (ai_base_url !== undefined) stmt.run('ai_base_url', ai_base_url);
      if (ai_report_interval_days !== undefined) stmt.run('ai_report_interval_days', String(ai_report_interval_days));
      if (ai_timeout !== undefined) stmt.run('ai_timeout', String(ai_timeout));
      if (ai_vision_model !== undefined) stmt.run('ai_vision_model', ai_vision_model);
    })();

    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存设置失败:', error);
    res.status(500).json({ error: '保存设置失败' });
  }
});

router.get('/settings/prompts', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE ?`).all(SETTING_PREFIX + '%');
    const customMap = {};
    rows.forEach(r => { customMap[r.key.slice(SETTING_PREFIX.length)] = r.value; });

    const prompts = Object.entries(PROMPTS).map(([key, def]) => {
      const custom = customMap[key];
      const isCustom = custom !== undefined && String(custom).trim() !== '' && String(custom) !== def.default;
      return {
        key,
        group: def.group,
        label: def.label,
        description: def.description,
        value: isCustom ? custom : def.default,
        is_custom: isCustom,
        has_custom: custom !== undefined && String(custom).trim() !== ''
      };
    });

    res.json({ prompts });
  } catch (error) {
    console.error('获取提示词设置失败:', error);
    res.status(500).json({ error: '获取提示词设置失败' });
  }
});

router.post('/settings/prompts', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const updates = req.body?.prompts;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: '参数错误' });
    }

    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (!PROMPTS[key]) continue; // 忽略未注册的提示词
        const v = String(value ?? '');
        if (v.trim() === '' || v === PROMPTS[key].default) {
          del.run(SETTING_PREFIX + key);
        } else {
          stmt.run(SETTING_PREFIX + key, v);
        }
      }
    })();

    res.json({ message: '提示词保存成功' });
  } catch (error) {
    console.error('保存提示词设置失败:', error);
    res.status(500).json({ error: '保存提示词设置失败' });
  }
});

router.post('/settings/prompts/reset', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : Object.keys(PROMPTS);
    const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
    db.transaction(() => {
      for (const key of keys) {
        if (PROMPTS[key]) del.run(SETTING_PREFIX + key);
      }
    })();

    res.json({ message: `已恢复 ${keys.length} 个提示词为默认值` });
  } catch (error) {
    console.error('恢复默认提示词失败:', error);
    res.status(500).json({ error: '恢复默认提示词失败' });
  }
});

router.post('/settings/ai/test', authenticateToken, requireAdmin, async (req, res) => {
  const axios = require('axios');
  try {
    let { ai_model, ai_api_key, ai_base_url, ai_timeout } = req.body;
    
    // 如果前端传了 *** 掩码，从数据库读取真实 key
    if (!ai_api_key || ai_api_key === '***') {
      ensureSettingsTable();
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'ai_api_key'`).get();
      ai_api_key = row?.value || '';
    }
    
    if (!ai_model || !ai_api_key || !ai_base_url) {
      return res.status(400).json({ error: '请填写完整的 AI 配置' });
    }

    const timeoutMs = (parseInt(ai_timeout) || 300) * 1000;

    console.log('\n========== AI 连接测试 ==========');
    console.log('🎯 目标地址:', `${ai_base_url}/chat/completions`);
    console.log('🤖 使用模型:', ai_model);
    console.log('🔑 API Key:', `${ai_api_key.slice(0, 8)}...${ai_api_key.slice(-4)}`);
    console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');

    const startTime = Date.now();
    const response = await axios.post(`${ai_base_url}/chat/completions`, {
      model: ai_model,
      messages: [{ role: 'user', content: '你好，请回复"连接成功"四个字。' }]
    }, {
      headers: {
        'Authorization': `Bearer ${ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const aiReply = response.data.choices?.[0]?.message?.content || '';
    console.log('✅ AI 响应成功, 耗时:', elapsed, '秒');
    console.log('📄 AI 回复内容:', aiReply);
    console.log('========================================\n');

    res.json({
      success: true,
      message: '连接测试成功',
      ai_reply: aiReply,
      elapsed: `${elapsed}秒`,
      model: ai_model
    });
  } catch (error) {
    console.error('\n❌ AI 连接测试失败:', error.message);
    if (error.response) {
      console.error('📡 响应状态:', error.response.status);
      console.error('📡 响应数据:', JSON.stringify(error.response.data));
      res.status(500).json({
        error: `连接失败 (HTTP ${error.response.status})`,
        detail: error.response.data?.error?.message || JSON.stringify(error.response.data)
      });
    } else if (error.code === 'ECONNABORTED') {
      console.error('⏱️ 请求超时');
      res.status(500).json({ error: `请求超时 (${timeoutMs / 1000}秒)`, detail: '请检查网络连接或 API 地址是否正确' });
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🚫 连接被拒绝');
      res.status(500).json({ error: '连接被拒绝', detail: '请检查 API 地址是否正确' });
    } else {
      console.error('❌ 未知错误:', error);
      res.status(500).json({ error: '连接失败', detail: error.message });
    }
  }
});

router.get('/settings/site', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const settings = db.prepare(`SELECT key, value FROM settings`).all();
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    // 只写不读：不暴露 API Key 到前端
    if (result.ai_api_key && result.ai_api_key.length > 0) {
      result.ai_api_key = '***';
    }
    res.json({ settings: result });
  } catch (error) {
    console.error('获取网站设置失败:', error);
    res.status(500).json({ error: '获取网站设置失败' });
  }
});

router.post('/settings/site', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const allowedKeys = [
      'site_name', 'site_description', 'site_logo', 'site_footer',
      'site_announcement', 'home_notice', 'registration_enabled', 'battle_enabled',
      'shop_enabled', 'max_pets_per_user', 'daily_login_gold',
      'battle_stamina_cost', 'ai_model', 'ai_api_key', 'ai_base_url',
      'ai_report_interval_days', 'ai_timeout',
      // 视觉模型：原先不在白名单里，导致「AI设置」页填写的视觉模型被静默丢弃
      'ai_vision_model',
      'perm_battle_records', 'perm_homework_records', 'perm_purchase_records',
      'max_tokens_per_generation', 'daily_teacher_gen_limit',
      'daily_global_token_limit', 'max_questions_per_generation',
    ];
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      Object.entries(req.body).forEach(([key, value]) => {
        if (allowedKeys.includes(key)) {
          // API Key 只写不读：仅在用户明确提供真实值时更新
          if (key === 'ai_api_key') {
            if (value !== undefined && value !== '' && value !== '***') {
              stmt.run(key, String(value));
            }
            return;
          }
          stmt.run(key, String(value));
        }
      });
    })();
    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存网站设置失败:', error);
    res.status(500).json({ error: '保存网站设置失败' });
  }
});

router.get('/settings/public', (req, res) => {
  try {
    ensureSettingsTable();
    const publicKeys = ['site_name', 'site_description', 'site_logo', 'site_footer', 'site_announcement', 'registration_enabled', 'home_notice'];
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${publicKeys.map(() => '?').join(',')})`).all(...publicKeys);
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    res.json({ settings: result });
  } catch (error) {
    console.error('获取公开设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

module.exports = router;
