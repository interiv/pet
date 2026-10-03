const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAwardAchievement } = require('./achievements');
const { grantReward } = require('../services/rewards');
const { getChinaDate, getChinaYesterday } = require('../config/timezone');

// 获取今日任务
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const today = getChinaDate();

    // 获取或创建今日任务记录
    let dailyTask = db.prepare(`
      SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
    `).get(userId, today);

    if (!dailyTask) {
      const yesterday = getChinaYesterday();
      const yesterdayTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, yesterday);

      let streakDays = 0;
      if (yesterdayTask && yesterdayTask.tasks_completed >= yesterdayTask.total_tasks) {
        streakDays = yesterdayTask.streak_days + 1;
      }

      db.prepare(`
        INSERT INTO daily_tasks (user_id, date, tasks_completed, total_tasks, streak_days)
        VALUES (?, ?, 0, 5, ?)
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
        { task_type: 'login', task_target: 1, task_progress: 0, is_completed: 0 },
        { task_type: 'complete_assignment', task_target: 1, task_progress: 0, is_completed: 0 },
        { task_type: 'feed_pet', task_target: 1, task_progress: 0, is_completed: 0 },
        { task_type: 'correct_rate', task_target: 80, task_progress: 0, is_completed: 0 },
        { task_type: 'review_weak_point', task_target: 3, task_progress: 0, is_completed: 0 }
      ];

      const insertLog = db.prepare(`
        INSERT INTO daily_task_logs (user_id, date, task_type, task_target, task_progress, is_completed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const task of defaultTasks) {
        insertLog.run(userId, today, task.task_type, task.task_target, task.task_progress, task.is_completed);
      }
      // 登录任务自动完成
      updateTaskProgress(userId, 'login', 1);
    }

    // 重新获取任务日志
    const updatedTaskLogs = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ?
    `).all(userId, today);

    // 历史迁移：为已有的今日任务补上 review_weak_point（代码升级后自动生效）
    const hasReviewTask = updatedTaskLogs.some(t => t.task_type === 'review_weak_point');
    if (!hasReviewTask) {
      db.prepare(`
        INSERT INTO daily_task_logs (user_id, date, task_type, task_target, task_progress, is_completed)
        VALUES (?, ?, 'review_weak_point', 3, 0, 0)
      `).run(userId, today);
      db.prepare(`
        UPDATE daily_tasks SET total_tasks = 5 WHERE user_id = ? AND date = ? AND total_tasks < 5
      `).run(userId, today);
      const reloaded = db.prepare(`
        SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ?
      `).all(userId, today);
      updatedTaskLogs.length = 0;
      updatedTaskLogs.push(...reloaded);
      dailyTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, today);
    }

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

/**
 * 更新任务进度（内部函数，供其他 API 调用）
 *
 * 约定：progress 传「本次增量」，函数内部负责累加（除 correct_rate 取历史最大值）。
 *
 * 历史坑：原实现是「直接赋值为 min(progress, target)」而非累加，
 * 于是调用方被迫自己先读旧值再加增量传进来——一旦某个调用方忘了这层约定直接传 1，
 * 目标值大于 1 的任务（如 review_weak_point 目标 3）就永远无法完成。
 * 改为内部累加后，调用方统一传增量即可，不会再踩这个坑。
 */
function updateTaskProgress(userId, taskType, progress) {
  try {
    const today = getChinaDate();

    let dailyTask = db.prepare(`
      SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
    `).get(userId, today);

    if (!dailyTask) {
      const yesterday = getChinaYesterday();
      const yesterdayTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, yesterday);
      let streakDays = 0;
      if (yesterdayTask && yesterdayTask.tasks_completed >= yesterdayTask.total_tasks) {
        streakDays = yesterdayTask.streak_days + 1;
      }
      db.prepare(`
        INSERT INTO daily_tasks (user_id, date, tasks_completed, total_tasks, streak_days)
        VALUES (?, ?, 0, 5, ?)
      `).run(userId, today, streakDays);
      dailyTask = db.prepare(`
        SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, today);
    }

    let taskLog = db.prepare(`
      SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ? AND task_type = ?
    `).get(userId, today, taskType);

    if (!taskLog) {
      const defaultTargets = {
        login: 1,
        complete_assignment: 1,
        feed_pet: 1,
        correct_rate: 80,
        review_weak_point: 3
      };
      db.prepare(`
        INSERT INTO daily_task_logs (user_id, date, task_type, task_target, task_progress, is_completed)
        VALUES (?, ?, ?, ?, 0, 0)
      `).run(userId, today, taskType, defaultTargets[taskType] || 1);
      taskLog = db.prepare(`
        SELECT * FROM daily_task_logs WHERE user_id = ? AND date = ? AND task_type = ?
      `).get(userId, today, taskType);
    }

    if (!taskLog) return;

    // 正确率类任务取历史最高值；其余类型按增量累加（原先是直接赋值，见函数头注释）
    const delta = Number(progress) || 0;
    let newProgress;
    if (taskType === 'correct_rate') {
      newProgress = Math.max(taskLog.task_progress, Math.min(delta, taskLog.task_target));
    } else {
      newProgress = Math.min(taskLog.task_progress + delta, taskLog.task_target);
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

      // 成就检查
      try {
        const totalCompleted = db.prepare("SELECT COUNT(*) as c FROM daily_task_logs WHERE user_id = ? AND is_completed = 1").get(userId)?.c || 0;
        checkAndAwardAchievement(userId, 'complete_daily_task', totalCompleted + 1);
      } catch (e) { console.error('成就检查失败:', e); }
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
    const today = getChinaDate();

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
    // 注意：任务定义（tasks 表）里写的是 exp 奖励，但这里原先只发金币，
    // 与前端文案不一致。现按定义补上经验，同时保留金币。
    let rewardGold = 0;
    let rewardExp = 0;
    let rewardMessage = '';

    switch (task_type) {
      case 'login':
        rewardGold = 5;
        rewardMessage = '登录奖励';
        break;
      case 'complete_assignment':
        rewardGold = 10;
        rewardExp = 100;
        rewardMessage = '完成作业奖励';
        break;
      case 'feed_pet':
        rewardGold = 5;
        rewardMessage = '投喂宠物奖励';
        break;
      case 'correct_rate':
        rewardGold = 15;
        rewardExp = 150;
        rewardMessage = '正确率达标奖励';
        break;
      case 'review_weak_point':
        rewardGold = 20;
        rewardMessage = '复习错题奖励';
        break;
      default:
        rewardGold = 5;
        rewardMessage = '任务奖励';
    }

    // 发放金币与经验（累计金币成就、升级判定、流水均由统一管道处理）
    grantReward(userId, {
      gold: rewardGold,
      exp: rewardExp,
      source: 'daily_task',
      reason: `${rewardMessage}: ${task_type}`,
    });

    // 标记奖励已领取
    db.prepare(`
      UPDATE daily_task_logs SET reward_claimed = 1 WHERE user_id = ? AND date = ? AND task_type = ?
    `).run(userId, today, task_type);

    // 检查是否所有任务都完成
    const dailyTask = db.prepare(`
      SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?
    `).get(userId, today);

    let allCompleted = false;
    let streakDays = dailyTask.streak_days;
    if (dailyTask.tasks_completed >= dailyTask.total_tasks) {
      allCompleted = true;
      // 检查昨天的连续天数，避免同一天重复累加
      const yesterday = getChinaYesterday();
      const yesterdayTask = db.prepare(`
        SELECT streak_days FROM daily_tasks WHERE user_id = ? AND date = ?
      `).get(userId, yesterday);
      const expectedStreak = (yesterdayTask?.streak_days || 0) + 1;
      if (dailyTask.streak_days < expectedStreak) {
        db.prepare(`
          UPDATE daily_tasks SET streak_days = ? WHERE user_id = ? AND date = ?
        `).run(expectedStreak, userId, today);
        streakDays = expectedStreak;
      }
    }

    const expText = rewardExp > 0 ? `，${rewardExp} 经验` : '';
    res.json({
      message: `领取成功！获得 ${rewardGold} 金币${expText}`,
      reward_gold: rewardGold,
      reward_exp: rewardExp,
      all_completed: allCompleted,
      // 修：原先这里返回 dailyTask.streak_days + 1，与上面已写入的 expectedStreak
      // 重复计算，会多报一天
      streak_days: streakDays,
    });
  } catch (error) {
    console.error('领取奖励失败:', error);
    res.status(500).json({ error: '领取奖励失败' });
  }
});

// 导出更新函数供其他模块使用
module.exports = { router, updateTaskProgress };
