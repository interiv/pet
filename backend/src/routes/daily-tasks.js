const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取今日任务
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    // 获取或创建今日任务记录
    let dailyTask = db.prepare(`
      SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
    `).get(userId, today);

    if (!dailyTask) {
      // 检查昨天的连续天数
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const yesterdayTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, yesterday);

      let streakDays = 0;
      if (yesterdayTask && yesterdayTask.tasks_completed >= yesterdayTask.total_tasks) {
        streakDays = yesterdayTask.streak_days + 1;
      }

      db.prepare(`
        INSERT INTO daily_tasks (user_id, date, tasks_completed, total_tasks, streak_days)
        VALUES (?, ?, 0, 4, ?)
      `).run(userId, today, streakDays);

      dailyTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, today);
    }

    // 获取任务日志
    const taskLogs = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ?
    `).all(userId, today);

    // 如果任务日志不存在，创建默认任务
    if (taskLogs.length === 0) {
      const defaultTasks = [
        { task_type: 'login', task_target: 1, task_progress: 1, is_completed: 1 }, // 登录自动完成
        { task_type: 'complete_assignment', task_target: 1, task_progress: 0, is_completed: 0 },
        { task_type: 'feed_pet', task_target: 1, task_progress: 0, is_completed: 0 },
        { task_type: 'correct_rate', task_target: 80, task_progress: 0, is_completed: 0 }
      ];

      const insertLog = db.prepare(`
        INSERT INTO daily_task_logs (user_id, date, task_type, task_target, task_progress, is_completed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const task of defaultTasks) {
        insertLog.run(userId, today, task.task_type, task.task_target, task.task_progress, task.is_completed);
      }
    }

    // 重新获取任务日志
    const updatedTaskLogs = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ?
    `).all(userId, today);

    // 计算可领取的奖励
    const claimableRewards = updatedTaskLogs.filter(log => log.is_completed && !log.reward_claimed);

    res.json({
      daily_task: dailyTask,
      tasks: updatedTaskLogs,
      streak_days: dailyTask.streak_days,
      claimable_rewards: claimableRewards
    });
  } catch (error) {
    console.error('获取每日任务失败:', error);
    res.status(500).json({ error: '获取每日任务失败' });
  }
});

// 更新任务进度（内部函数，供其他API调用）
function updateTaskProgress(userId, taskType, progress) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const taskLog = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ? AND task_type = ?
    `).get(userId, today, taskType);

    if (!taskLog) return;

    // 对于正确率类任务，只取更高值（防止覆盖降低）
    let newProgress;
    if (taskType === 'correct_rate') {
      newProgress = Math.max(taskLog.task_progress, Math.min(progress, taskLog.task_target));
    } else {
      newProgress = Math.min(progress, taskLog.task_target);
    }
    const isCompleted = newProgress >= taskLog.task_target ? 1 : 0;

    db.prepare(`
      UPDATE daily_task_logs 
      SET task_progress = ?, is_completed = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND date = ? AND task_type = ?
    `).run(newProgress, isCompleted, userId, today, taskType);

    // 如果任务刚完成，更新总完成数
    if (isCompleted && taskLog.is_completed === 0) {
      db.prepare(`
        UPDATE daily_tasks 
        SET tasks_completed = tasks_completed + 1, last_updated = CURRENT_TIMESTAMP
        WHERE user_id = ? AND date = ?
      `).run(userId, today);
    }
  } catch (error) {
    console.error('更新任务进度失败:', error);
  }
}

// 领取任务奖励
router.post('/claim', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { task_type } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const taskLog = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ? AND task_type = ?
    `).get(userId, today, task_type);

    if (!taskLog) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (!taskLog.is_completed) {
      return res.status(400).json({ error: '任务未完成' });
    }

    if (taskLog.reward_claimed) {
      return res.status(400).json({ error: '奖励已领取' });
    }

    // 根据任务类型发放奖励
    let rewardGold = 0;
    let rewardMessage = '';

    switch (task_type) {
      case 'login':
        rewardGold = 5;
        rewardMessage = '登录奖励';
        break;
      case 'complete_assignment':
        rewardGold = 10;
        rewardMessage = '完成作业奖励';
        break;
      case 'feed_pet':
        rewardGold = 5;
        rewardMessage = '投喂宠物奖励';
        break;
      case 'correct_rate':
        rewardGold = 15;
        rewardMessage = '正确率达标奖励';
        break;
      default:
        rewardGold = 5;
        rewardMessage = '任务奖励';
    }

    // 发放金币
    db.prepare(`
      UPDATE users SET gold = gold + ? WHERE id = ?
    `).run(rewardGold, userId);

    // 标记奖励已领取
    db.prepare(`
      UPDATE daily_task_logs SET reward_claimed = 1 WHERE user_id = ? AND date = ? AND task_type = ?
    `).run(userId, today, task_type);

    // 检查是否所有任务都完成
    const dailyTask = db.prepare(`
      SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
    `).get(userId, today);

    let allCompleted = false;
    if (dailyTask.tasks_completed >= dailyTask.total_tasks) {
      allCompleted = true;
      // 检查昨天的连续天数，避免同一天重复累加
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const yesterdayTask = db.prepare(`
        SELECT streak_days FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, yesterday);
      const expectedStreak = (yesterdayTask?.streak_days || 0) + 1;
      if (dailyTask.streak_days < expectedStreak) {
        db.prepare(`
          UPDATE daily_tasks SET streak_days = ? WHERE user_id = ? AND date = ?
        `).run(expectedStreak, userId, today);
      }
    }

    res.json({
      message: `领取成功！获得 ${rewardGold} 金币`,
      reward_gold: rewardGold,
      all_completed: allCompleted,
      streak_days: dailyTask.streak_days + (allCompleted ? 1 : 0)
    });
  } catch (error) {
    console.error('领取奖励失败:', error);
    res.status(500).json({ error: '领取奖励失败' });
  }
});

// 导出更新函数供其他模块使用
module.exports = { router, updateTaskProgress };
