const { db } = require('../src/config/database');

console.log('测试statistics查询...\n');

try {
  // 模拟admin用户的statistics查询
  const userRole = 'admin';
  const userId = 1;

  const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
  const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'`).get().count;
  const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`).get().count;
  const totalGold = db.prepare(`SELECT SUM(gold) as total FROM users`).get().total || 0;

  let statistics = {
    users: { total: totalUsers, teachers: totalTeachers, students: totalStudents },
    totals: { gold: totalGold }
  };

  if (userRole === 'admin') {
    const totalClasses = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
    const totalPets = db.prepare(`SELECT COUNT(*) as count FROM pets`).get().count;
    const totalBattles = db.prepare(`SELECT COUNT(*) as count FROM battles`).get().count;
    const activeTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'active'`).get().count;
    const pendingTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'pending_approval'`).get().count;
    const totalExp = db.prepare(`SELECT SUM(exp) as total FROM pets`).get().total || 0;

    // 检查表是否存在
    const hasUserActivities = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_activities'`).get();
    const hasGoldTransactions = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='gold_transactions'`).get();

    let dailyActiveUsers = 0;
    if (hasUserActivities) {
      dailyActiveUsers = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as count FROM user_activities
        WHERE DATE(created_at) = DATE('now', 'localtime')
      `).get().count || 0;
    }

    let dailyGoldDistributed = 0;
    let dailyGoldConsumed = 0;
    if (hasGoldTransactions) {
      dailyGoldDistributed = db.prepare(`
        SELECT COALESCE(SUM(gold_change), 0) as total FROM gold_transactions
        WHERE DATE(created_at) = DATE('now', 'localtime') AND gold_change > 0
      `).get().total || 0;

      dailyGoldConsumed = db.prepare(`
        SELECT COALESCE(SUM(ABS(gold_change)), 0) as total FROM gold_transactions
        WHERE DATE(created_at) = DATE('now', 'localtime') AND gold_change < 0
      `).get().total || 0;
    }

    const topClasses = db.prepare(`
      SELECT c.id, c.name, c.total_exp, c.student_count,
        (SELECT u.username FROM class_teachers ct JOIN users u ON ct.teacher_id = u.id WHERE ct.class_id = c.id AND ct.role = 'head_teacher' LIMIT 1) as teacher_name
      FROM classes c
      ORDER BY c.total_exp DESC LIMIT 5
    `).all();

    const recentRegistrations = db.prepare(`
      SELECT id, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 10
    `).all();

    const topSellingItems = db.prepare(`
      SELECT i.name, i.rarity, COUNT(ui.id) as purchase_count, SUM(ui.quantity) as total_quantity
      FROM user_items ui
      JOIN items i ON ui.item_id = i.id
      GROUP BY i.id
      ORDER BY purchase_count DESC
      LIMIT 10
    `).all();

    statistics = {
      ...statistics,
      classes: { total: totalClasses },
      pets: { total: totalPets },
      battles: { total: totalBattles },
      totals: { gold: totalGold, exp: totalExp },
      status: {
        active_teachers: activeTeachers,
        pending_teachers: pendingTeachers
      },
      daily: {
        active_users: dailyActiveUsers,
        gold_distributed: dailyGoldDistributed,
        gold_consumed: dailyGoldConsumed
      },
      top_classes: topClasses,
      top_selling_items: topSellingItems,
      recent_registrations: recentRegistrations
    };
  }

  console.log('✅ Statistics查询成功！');
  console.log('\n统计数据:');
  console.log('  总用户数:', statistics.users.total);
  console.log('  教师数:', statistics.users.teachers);
  console.log('  学生数:', statistics.users.students);
  console.log('  班级数:', statistics.classes.total);
  console.log('  宠物数:', statistics.pets.total);
  console.log('  战斗数:', statistics.battles.total);
  console.log('  总金币:', statistics.totals.gold);
  console.log('  总经验:', statistics.totals.exp);
  console.log('  日活跃用户:', statistics.daily.active_users);
  console.log('  日金币分发:', statistics.daily.gold_distributed);
  console.log('  日金币消耗:', statistics.daily.gold_consumed);
  
} catch (error) {
  console.error('❌ Statistics查询失败:', error.message);
  console.error(error);
}
