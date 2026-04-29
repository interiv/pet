const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

console.log('=== 初始化数据库 ===\n');

const dataDir = path.join(__dirname, '../data');
let dbPath = path.join(dataDir, 'database.sqlite');
const petsDir = path.join(__dirname, '../../frontend/public/images/pets');
const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

const useTestData = process.argv.includes('--test-data');

// ============================================================
// 1. 删除旧数据库
// ============================================================
if (fs.existsSync(dbPath)) {
  console.log('1. 删除旧数据库...');
  try {
    fs.unlinkSync(dbPath);
    console.log('   ✓ 旧数据库已删除\n');
  } catch (e) {
    console.log('   ⚠  删除失败，使用新文件名...');
    const timestamp = Date.now();
    dbPath = path.join(dataDir, `database_${timestamp}.sqlite`);
    console.log(`   将使用新数据库: database_${timestamp}.sqlite\n`);
  }
} else {
  console.log('1. 数据库不存在，跳过删除\n');
}

console.log('2. 创建新数据库...');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log('   ✓ 数据库创建成功\n');

console.log('3. 创建表结构...\n');

// ============================================================
// 3. 基础表 (原 init_db.js)
// ============================================================

db.exec(`
  -- ==================== 用户 ====================
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'student',
    class_id INTEGER,
    avatar TEXT,
    gold INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    status TEXT DEFAULT 'active'
  );

  -- ==================== 学校 (SaaS多租户) ====================
  CREATE TABLE schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT,
    region TEXT,
    admin_user_id INTEGER,
    logo TEXT,
    theme_color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id)
  );

  -- ==================== 班级 ====================
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT,
    teacher_id INTEGER,
    student_count INTEGER DEFAULT 0,
    total_exp INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    head_teacher_id INTEGER REFERENCES users(id),
    school_id INTEGER REFERENCES schools(id),
    slug TEXT,
    description TEXT,
    cover_image TEXT,
    is_public INTEGER DEFAULT 1
  );

  -- ==================== 班级教师 ====================
  CREATE TABLE class_teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    role TEXT DEFAULT 'teacher',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_id, teacher_id),
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (teacher_id) REFERENCES users(id)
  );

  -- ==================== 班级申请 ====================
  CREATE TABLE class_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id),
    UNIQUE(user_id, class_id)
  );

  -- ==================== 班级邀请码 ====================
  CREATE TABLE class_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    invitation_code TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL,
    role_filter TEXT DEFAULT 'any' CHECK(role_filter IN ('student', 'teacher', 'any')),
    max_uses INTEGER DEFAULT NULL,
    used_count INTEGER DEFAULT 0,
    expires_at DATETIME DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- ==================== 公告 ====================
  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    publisher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  -- ==================== 宠物种类 ====================
  CREATE TABLE pet_species (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    element_type TEXT,
    base_stats TEXT,
    growth_rate REAL DEFAULT 1.0,
    unlock_condition TEXT,
    image_urls TEXT,
    description TEXT
  );

  -- ==================== 宠物 ====================
  CREATE TABLE pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    species_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    exp INTEGER DEFAULT 0,
    hunger INTEGER DEFAULT 100,
    mood INTEGER DEFAULT 100,
    health INTEGER DEFAULT 100,
    stamina INTEGER DEFAULT 100,
    attack INTEGER DEFAULT 10,
    defense INTEGER DEFAULT 10,
    speed INTEGER DEFAULT 10,
    crit_rate REAL DEFAULT 0.05,
    image_id INTEGER,
    current_equipment TEXT,
    growth_stage TEXT DEFAULT '宠物蛋',
    friendship_points INTEGER DEFAULT 0,
    win_count INTEGER DEFAULT 0,
    total_battles INTEGER DEFAULT 0,
    status TEXT DEFAULT 'normal',
    rebirth_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (species_id) REFERENCES pet_species(id)
  );

  -- ==================== 物品 ====================
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT,
    effect_type TEXT,
    effect_value INTEGER,
    price INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    rarity TEXT DEFAULT 'common'
  );

  -- ==================== 用户物品 ====================
  CREATE TABLE user_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES items(id)
  );

  -- ==================== 装备 ====================
  CREATE TABLE equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slot TEXT,
    stats_bonus TEXT,
    set_id INTEGER,
    price INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    rarity TEXT DEFAULT 'common',
    required_level INTEGER DEFAULT 1
  );

  -- ==================== 用户装备 ====================
  CREATE TABLE user_equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    equipped INTEGER DEFAULT 0,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    level INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(id)
  );

  -- ==================== 技能 (答题战斗模式) ====================
  CREATE TABLE skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    skill_type TEXT NOT NULL,
    subject TEXT,
    base_damage INTEGER DEFAULT 0,
    base_defense INTEGER DEFAULT 0,
    base_speed INTEGER DEFAULT 0,
    cooldown INTEGER DEFAULT 0,
    required_level INTEGER DEFAULT 1,
    required_knowledge_point TEXT,
    required_accuracy REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== 宠物技能 ====================
  CREATE TABLE pet_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    mastery INTEGER DEFAULT 0,
    slot INTEGER,
    last_used TEXT,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pet_id, skill_id),
    FOREIGN KEY (pet_id) REFERENCES pets(id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
  );

  -- ==================== 战斗记录 ====================
  CREATE TABLE battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet1_id INTEGER NOT NULL,
    pet2_id INTEGER NOT NULL,
    winner_id INTEGER,
    battle_type TEXT DEFAULT 'pvp',
    reward_exp INTEGER DEFAULT 0,
    reward_gold INTEGER DEFAULT 0,
    battle_log TEXT,
    battle_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    season_id INTEGER,
    rank_change INTEGER DEFAULT 0
  );

  -- ==================== 题库 ====================
  CREATE TABLE question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    topic TEXT,
    difficulty TEXT DEFAULT 'medium',
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    options TEXT,
    answer TEXT NOT NULL,
    explanation TEXT,
    analysis TEXT,
    hint TEXT,
    variant_group_id INTEGER,
    variant_index INTEGER DEFAULT 0,
    source TEXT DEFAULT 'ai',
    usage_count INTEGER DEFAULT 0,
    knowledge_point TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
  );

  -- ==================== 作业 ====================
  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    subject TEXT,
    question_type TEXT,
    questions TEXT,
    max_exp INTEGER DEFAULT 100,
    due_date DATETIME,
    status TEXT DEFAULT 'active',
    ai_config TEXT,
    class_id INTEGER REFERENCES classes(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id)
  );

  -- ==================== 作业题目关联 ====================
  CREATE TABLE assignment_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    question_bank_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    score_weight REAL DEFAULT 1.0,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id),
    FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
  );

  -- ==================== 提交 ====================
  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    answers TEXT,
    attachments TEXT,
    status TEXT DEFAULT 'submitted',
    ai_score REAL,
    ai_feedback TEXT,
    teacher_score REAL,
    teacher_feedback TEXT,
    exp_reward INTEGER DEFAULT 0,
    gold_reward INTEGER DEFAULT 0,
    dropped_item TEXT,
    total_score REAL,
    total_max_score REAL,
    review_status TEXT DEFAULT 'pending',
    attempt_count INTEGER DEFAULT 1,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    graded_at DATETIME,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 题目作答记录 ====================
  CREATE TABLE question_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_bank_id INTEGER NOT NULL,
    attempt_number INTEGER DEFAULT 1,
    student_answer TEXT,
    is_correct INTEGER DEFAULT 0,
    score REAL,
    max_score REAL,
    feedback TEXT,
    image_url TEXT,
    reviewed_at DATETIME,
    answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES submissions(id),
    FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
  );

  -- ==================== 上传文件 ====================
  CREATE TABLE upload_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    upload_type TEXT DEFAULT 'assignment',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== 好友 ====================
  CREATE TABLE friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    friendship_level INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_interaction DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
  );

  -- ==================== 好友请求 ====================
  CREATE TABLE friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    UNIQUE(sender_id, receiver_id)
  );

  -- ==================== 任务定义 ====================
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'daily',
    name TEXT NOT NULL,
    description TEXT,
    condition TEXT,
    reward TEXT,
    reset_type TEXT DEFAULT 'daily',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== 用户任务进度 ====================
  CREATE TABLE user_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    completed_at DATETIME,
    reset_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  -- ==================== 每日任务 ====================
  CREATE TABLE daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    tasks_completed INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 4,
    streak_days INTEGER DEFAULT 0,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
  );

  -- ==================== 每日任务日志 ====================
  CREATE TABLE daily_task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_target INTEGER DEFAULT 0,
    task_progress INTEGER DEFAULT 0,
    is_completed INTEGER DEFAULT 0,
    reward_claimed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date, task_type)
  );

  -- ==================== 成就定义 ====================
  CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    condition TEXT,
    reward_type TEXT,
    reward_value INTEGER
  );

  -- ==================== 用户成就 ====================
  CREATE TABLE user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (achievement_id) REFERENCES achievements(id)
  );

  -- ==================== 错题本 ====================
  CREATE TABLE wrong_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    assignment_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    wrong_answer TEXT,
    correct_answer TEXT,
    analysis TEXT,
    reviewed INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 1,
    reviewed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (assignment_id) REFERENCES assignments(id)
  );

  -- ==================== 知识点统计 ====================
  CREATE TABLE knowledge_point_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    knowledge_point TEXT NOT NULL,
    date TEXT NOT NULL,
    total_attempts INTEGER DEFAULT 0,
    correct_attempts INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, knowledge_point, date)
  );

  -- ==================== 金币交易记录 ====================
  CREATE TABLE gold_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    gold_change INTEGER NOT NULL,
    reason TEXT,
    source TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 用户活动记录 ====================
  CREATE TABLE user_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 动态/朋友圈 ====================
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    images TEXT,
    scope TEXT DEFAULT 'class',
    class_id INTEGER,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    is_top INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  -- ==================== 动态点赞 ====================
  CREATE TABLE post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 动态评论 ====================
  CREATE TABLE post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    like_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
  );

  -- ==================== 聊天消息 ====================
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    room_id INTEGER,
    target_user_id INTEGER,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (room_id) REFERENCES classes(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
  );

  -- ==================== 聊天已读状态 ====================
  CREATE TABLE chat_read_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT,
    room_id INTEGER,
    target_user_id INTEGER,
    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, room_type, room_id),
    UNIQUE(user_id, target_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
  );

  -- ==================== 论坛板块 ====================
  CREATE TABLE forums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    thread_count INTEGER DEFAULT 0,
    post_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== 论坛帖子 ====================
  CREATE TABLE forum_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forum_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    is_top INTEGER DEFAULT 0,
    is_essence INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    class_id INTEGER,
    last_reply_user_id INTEGER,
    last_reply_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (forum_id) REFERENCES forums(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (last_reply_user_id) REFERENCES users(id)
  );

  -- ==================== 论坛回复 ====================
  CREATE TABLE forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    is_first_post INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    forum_id INTEGER REFERENCES forums(id),
    class_id INTEGER,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES forum_posts(id) ON DELETE CASCADE
  );

  -- ==================== 论坛帖子标签 ====================
  CREATE TABLE forum_thread_tags (
    thread_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    PRIMARY KEY (thread_id, tag_name),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
  );

  -- ==================== 论坛帖子点赞 ====================
  CREATE TABLE forum_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 论坛回复点赞 ====================
  CREATE TABLE forum_post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 论坛收藏 ====================
  CREATE TABLE forum_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== 通知 ====================
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    source_type TEXT,
    source_id INTEGER,
    is_read INTEGER DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ==================== Boss战斗 ====================
  CREATE TABLE boss_battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    boss_name TEXT NOT NULL,
    boss_description TEXT,
    boss_icon TEXT,
    boss_hp INTEGER NOT NULL,
    boss_max_hp INTEGER NOT NULL,
    boss_level INTEGER NOT NULL,
    knowledge_point TEXT,
    source_question_id INTEGER,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== Boss战斗参与者 ====================
  CREATE TABLE boss_battle_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boss_battle_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    pet_id INTEGER,
    damage_dealt INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    total_attempts INTEGER DEFAULT 0,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_attack_at TEXT,
    UNIQUE(boss_battle_id, user_id)
  );

  -- ==================== Boss战斗奖励 ====================
  CREATE TABLE boss_battle_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boss_battle_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reward_type TEXT NOT NULL,
    reward_value INTEGER NOT NULL,
    claimed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(boss_battle_id, user_id, reward_type)
  );

  -- ==================== AI配置 ====================
  CREATE TABLE ai_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_name TEXT NOT NULL,
    model_type TEXT,
    api_endpoint TEXT,
    api_key TEXT,
    parameters TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==================== 系统设置 ====================
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

console.log('   ✓ 表结构创建成功 (50张表)\n');

// ============================================================
// 4. 创建索引
// ============================================================
console.log('4. 创建索引...');

db.exec(`
  -- 题库索引
  CREATE INDEX idx_qb_variant_group ON question_bank(variant_group_id);
  CREATE INDEX idx_qb_subject ON question_bank(subject);

  -- 作业题目索引
  CREATE INDEX idx_aq_assignment ON assignment_questions(assignment_id);
  CREATE INDEX idx_aq_question ON assignment_questions(question_bank_id);

  -- 题目作答索引
  CREATE INDEX idx_qa_submission ON question_answers(submission_id);
  CREATE INDEX idx_qa_question ON question_answers(question_bank_id);

  -- 好友索引
  CREATE INDEX idx_friend_requests_sender ON friend_requests(sender_id, status);
  CREATE INDEX idx_friend_requests_receiver ON friend_requests(receiver_id, status);
  CREATE INDEX idx_friends_status ON friends(user_id, status);

  -- 金币交易索引
  CREATE INDEX idx_gold_transactions_user ON gold_transactions(user_id);
  CREATE INDEX idx_gold_transactions_created ON gold_transactions(created_at);

  -- 用户活动索引
  CREATE INDEX idx_user_activities_user ON user_activities(user_id);
  CREATE INDEX idx_user_activities_created ON user_activities(created_at);

  -- 通知索引
  CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX idx_notifications_type ON notifications(user_id, type, created_at DESC);

  -- 动态索引
  CREATE INDEX idx_posts_user ON posts(user_id, created_at DESC);
  CREATE INDEX idx_posts_class ON posts(class_id, created_at DESC);
  CREATE INDEX idx_posts_scope ON posts(scope, created_at DESC);
  CREATE INDEX idx_post_likes ON post_likes(post_id, user_id);
  CREATE INDEX idx_post_comments ON post_comments(post_id, created_at ASC);

  -- 聊天索引
  CREATE INDEX idx_chat_messages_room ON chat_messages(room_type, room_id, created_at ASC);
  CREATE INDEX idx_chat_messages_private ON chat_messages(user_id, target_user_id, created_at ASC);

  -- 论坛索引
  CREATE INDEX idx_forum_threads_forum ON forum_threads(forum_id, status, last_reply_at DESC);
  CREATE INDEX idx_forum_threads_class_id ON forum_threads(class_id);
  CREATE INDEX idx_forum_posts_thread ON forum_posts(thread_id, created_at ASC);

  -- Boss战斗索引
  CREATE INDEX idx_boss_class ON boss_battles(class_id, status);
  CREATE INDEX idx_boss_participant ON boss_battle_participants(boss_battle_id, user_id);
  CREATE INDEX idx_boss_rewards ON boss_battle_rewards(boss_battle_id, user_id);

  -- 班级索引
  CREATE UNIQUE INDEX idx_classes_slug ON classes(slug);
  CREATE INDEX idx_posts_class_id ON posts(class_id);
`);

console.log('   ✓ 索引创建成功\n');

// ============================================================
// 5. 创建视图
// ============================================================
console.log('5. 创建视图...');

db.exec(`
  CREATE VIEW knowledge_point_accuracy AS
  SELECT
    user_id,
    knowledge_point,
    date,
    total_attempts,
    correct_attempts,
    ROUND(CAST(correct_attempts AS REAL) / total_attempts * 100, 2) as accuracy
  FROM knowledge_point_stats
  WHERE total_attempts > 0
`);

console.log('   ✓ 视图创建成功\n');

// ============================================================
// 6. 初始化基础数据
// ============================================================
console.log('6. 初始化基础数据...');

// --- 宠物种类 (32种) ---
const petsData = [
  { name: '火焰狮', element_type: 'fire', desc: '热情似火的狮子，拥有强大的攻击力' },
  { name: '水灵龟', element_type: 'water', desc: '温和的水之守护者，拥有极高的防御力' },
  { name: '森林鹿', element_type: 'grass', desc: '优雅的森林精灵，速度敏捷' },
  { name: '光明鸟', element_type: 'light', desc: '神圣的光明使者，平衡而优雅' },
  { name: '暗影狼', element_type: 'dark', desc: '神秘的暗影猎手，高攻高敏' },
  { name: '雷霆狐', element_type: 'light', desc: '掌控雷电的灵狐，速度极快' },
  { name: '冰晶熊', element_type: 'water', desc: '身披冰晶铠甲的巨熊，防御惊人' },
  { name: '疾风鹰', element_type: 'grass', desc: '驾驭狂风的猛禽，灵动迅捷' },
  { name: '大地象', element_type: 'grass', desc: '坚如磐石的巨象，力量无穷' },
  { name: '钢铁犀', element_type: 'dark', desc: '浑身钢铁的犀牛，无坚不摧' },
  { name: '熔岩龙', element_type: 'fire', desc: '诞生于火山的巨龙，毁灭一切' },
  { name: '深海鲸', element_type: 'water', desc: '潜游深海的巨兽，生命力极强' },
  { name: '剧毒蝎', element_type: 'dark', desc: '隐藏在暗处的毒蝎，致命一击' },
  { name: '幻影猫', element_type: 'dark', desc: '能制造幻影的灵猫，神秘莫测' },
  { name: '荆棘蛇', element_type: 'grass', desc: '浑身长满倒刺的毒蛇，令人生畏' },
  { name: '圣光兽', element_type: 'light', desc: '传说中的神圣独角兽，治愈万物' },
  { name: '幽冥蝠', element_type: 'dark', desc: '倒悬于深渊的吸血蝙蝠' },
  { name: '闪电豹', element_type: 'light', desc: '快如闪电的猎豹，瞬间爆发' },
  { name: '极地狐', element_type: 'water', desc: '极寒之地的妖狐，擅长冰冻' },
  { name: '狂风熊', element_type: 'grass', desc: '能呼唤风暴的狂熊' },
  { name: '岩石鳄', element_type: 'grass', desc: '潜伏在沙石中的远古巨鳄' },
  { name: '钛金龙', element_type: 'dark', desc: '金属构造的飞龙，穿梭天际' },
  { name: '赤炎凤', element_type: 'fire', desc: '浴火重生的神鸟凤凰' },
  { name: '潮汐马', element_type: 'water', desc: '掌控海潮的魔法海马' },
  { name: '灵木猿', element_type: 'grass', desc: '穿梭于林间的智慧巨猿' },
  { name: '晨星灵', element_type: 'light', desc: '伴随晨星降临的小精灵' },
  { name: '梦魇犬', element_type: 'dark', desc: '带来无尽噩梦的地狱恶犬' },
  { name: '雷云虎', element_type: 'light', desc: '背负雷云的百兽之王' },
  { name: '霜冻企鹅', element_type: 'water', desc: '操控冰霜的极地企鹅' },
  { name: '飓风螳螂', element_type: 'grass', desc: '挥舞双刀卷起飓风的螳螂' },
  { name: '沙漠鸵', element_type: 'fire', desc: '奔跑在沙漠中的巨型鸵鸟' },
  { name: '秘银龟', element_type: 'light', desc: '背负秘银重壳的长寿灵龟' }
];

const insertSpecies = db.prepare('INSERT INTO pet_species (name, element_type, base_stats, growth_rate, description, image_urls) VALUES (?, ?, ?, ?, ?, ?)');
petsData.forEach((p) => {
  const baseStats = JSON.stringify({ attack: 10 + Math.floor(Math.random() * 10), defense: 10 + Math.floor(Math.random() * 10), speed: 10 + Math.floor(Math.random() * 10) });
  const growthRate = (1.0 + Math.random() * 0.5).toFixed(2);
  const imageUrls = {};
  const speciesDir = path.join(petsDir, p.name);

  if (fs.existsSync(speciesDir)) {
    for (const stage of stages) {
      const imgPath = path.join(speciesDir, `${stage}.png`);
      if (fs.existsSync(imgPath)) {
        imageUrls[stage] = `/images/pets/${p.name}/${stage}.png`;
      }
    }
  }

  insertSpecies.run(p.name, p.element_type, baseStats, growthRate, p.desc, JSON.stringify(imageUrls));
});
console.log('   ✓ 宠物种类初始化完成 (32种)');

// --- 物品 (28种) ---
const items = [
  { name: '普通粮食', type: 'food', effect_type: 'exp', effect_value: 10, price: 10, description: '普通的宠物粮食', rarity: 'common', image_url: '/images/items/普通粮食.png' },
  { name: '高级零食', type: 'food', effect_type: 'exp', effect_value: 50, price: 50, description: '美味的零食', rarity: 'rare', image_url: '/images/items/高级零食.png' },
  { name: '特殊料理', type: 'food', effect_type: 'exp', effect_value: 100, price: 100, description: '精心制作的料理', rarity: 'epic', image_url: '/images/items/特殊料理.png' },
  { name: '蜜汁烤肉', type: 'food', effect_type: 'exp', effect_value: 150, price: 150, description: '香气四溢的烤肉，宠物超喜欢', rarity: 'epic', image_url: '/images/items/蜜汁烤肉.png' },
  { name: '黄金苹果', type: 'food', effect_type: 'exp', effect_value: 200, price: 200, description: '传说中的黄金苹果', rarity: 'legendary', image_url: '/images/items/黄金苹果.png' },
  { name: '生命果实', type: 'food', effect_type: 'health', effect_value: 100, price: 80, description: '恢复宠物全部生命值', rarity: 'rare', image_url: '/images/items/生命果实.png' },
  { name: '活力果实', type: 'food', effect_type: 'stamina', effect_value: 100, price: 80, description: '恢复宠物全部体力值', rarity: 'rare', image_url: '/images/items/活力果实.png' },
  { name: '快乐糖果', type: 'food', effect_type: 'mood', effect_value: 50, price: 50, description: '让宠物心情大好', rarity: 'common', image_url: '/images/items/快乐糖果.png' },
  { name: '彩虹蛋糕', type: 'food', effect_type: 'mood', effect_value: 100, price: 120, description: '美味的彩虹蛋糕', rarity: 'epic', image_url: '/images/items/彩虹蛋糕.png' },
  { name: '力量果实', type: 'food', effect_type: 'attack', effect_value: 1, price: 500, description: '永久提升1点攻击力', rarity: 'legendary', image_url: '🍎' },
  { name: '铁骨果实', type: 'food', effect_type: 'defense', effect_value: 1, price: 500, description: '永久提升1点防御力', rarity: 'legendary', image_url: '🥥' },
  { name: '疾风果实', type: 'food', effect_type: 'speed', effect_value: 1, price: 500, description: '永久提升1点速度', rarity: 'legendary', image_url: '🍇' },
  { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得200经验', rarity: 'epic', image_url: '/images/items/经验药水.png' },
  { name: '超级经验药水', type: 'potion', effect_type: 'exp', effect_value: 500, price: 500, description: '立即获得500经验', rarity: 'legendary', image_url: '/images/items/超级经验药水.png' },
  { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升心情值', rarity: 'common', image_url: '/images/items/心情药水.png' },
  { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复健康值', rarity: 'common', image_url: '/images/items/治疗药剂.png' },
  { name: '大治疗药剂', type: 'potion', effect_type: 'health', effect_value: 100, price: 100, description: '恢复全部健康值', rarity: 'rare', image_url: '/images/items/大治疗药剂.png' },
  { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复体力值', rarity: 'common', image_url: '/images/items/体力药剂.png' },
  { name: '大体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 100, price: 100, description: '恢复全部体力值', rarity: 'rare', image_url: '/images/items/大体力药剂.png' },
  { name: '保护罩', type: 'potion', effect_type: 'shield', effect_value: 1, price: 100, description: '防止战斗失败掉落经验', rarity: 'rare', image_url: '/images/items/保护罩.png' },
  { name: '力量药水', type: 'potion', effect_type: 'buff_attack', effect_value: 10, price: 150, description: '临时提升攻击力10点', rarity: 'rare', image_url: '/images/items/力量药水.png' },
  { name: '铁壁药水', type: 'potion', effect_type: 'buff_defense', effect_value: 10, price: 150, description: '临时提升防御力10点', rarity: 'rare', image_url: '/images/items/铁壁药水.png' },
  { name: '疾风药水', type: 'potion', effect_type: 'buff_speed', effect_value: 10, price: 150, description: '临时提升速度10点', rarity: 'rare', image_url: '/images/items/疾风药水.png' },
  { name: '狂暴药水', type: 'potion', effect_type: 'buff_crit', effect_value: 0.2, price: 200, description: '临时提升暴击率20%', rarity: 'epic', image_url: '/images/items/狂暴药水.png' },
  { name: '幸运草', type: 'potion', effect_type: 'luck', effect_value: 1, price: 300, description: '下一次战斗获得双倍金币', rarity: 'epic', image_url: '/images/items/幸运草.png' },
  { name: '改名卡', type: 'potion', effect_type: 'rename', effect_value: 1, price: 500, description: '修改宠物的名字', rarity: 'rare', image_url: '/images/items/改名卡.png' },
  { name: '转生丹', type: 'potion', effect_type: 'reincarnate', effect_value: 1, price: 1000, description: '宠物重置为1级，保留属性加成', rarity: 'legendary', image_url: '/images/items/转生丹.png' },
  { name: '经验加倍卡', type: 'potion', effect_type: 'double_exp', effect_value: 10, price: 300, description: '接下来10次获得经验时双倍', rarity: 'epic', image_url: '/images/items/经验加倍卡.png' }
];

const insertItem = db.prepare('INSERT INTO items (name, type, effect_type, effect_value, price, description, rarity, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
items.forEach(i => insertItem.run(i.name, i.type, i.effect_type, i.effect_value, i.price, i.description, i.rarity, i.image_url));
console.log('   ✓ 物品数据初始化完成 (28种)');

// --- 装备 (25件) ---
const equipment = [
  { name: '铁剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 5 }), price: 100, rarity: 'common', required_level: 1, image_url: '/images/equipment/铁剑_ai.png' },
  { name: '钢剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 10 }), price: 200, rarity: 'rare', required_level: 10, image_url: '/images/equipment/钢剑_ai.png' },
  { name: '火焰之剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 20 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/火焰之剑_ai.png' },
  { name: '精灵之弓', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 15, speed: 10 }), price: 350, rarity: 'rare', required_level: 15, image_url: '/images/equipment/精灵之弓_ai.png' },
  { name: '雷霆法杖', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 25, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '/images/equipment/雷霆法杖_ai.png' },
  { name: '圣光十字剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 40, defense: 10 }), price: 1200, rarity: 'legendary', required_level: 50, image_url: '/images/equipment/圣光十字剑_ai.png' },
  { name: '暗影匕首', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 18, speed: 20 }), price: 450, rarity: 'epic', required_level: 25, image_url: '/images/equipment/暗影匕首_ai.png' },
  { name: '布衣', slot: 'armor', stats_bonus: JSON.stringify({ defense: 5 }), price: 100, rarity: 'common', required_level: 1, image_url: '/images/equipment/布衣_ai.png' },
  { name: '铁甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 10 }), price: 200, rarity: 'rare', required_level: 10, image_url: '/images/equipment/铁甲_ai.png' },
  { name: '龙鳞甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 20 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/龙鳞甲_ai.png' },
  { name: '精灵长袍', slot: 'armor', stats_bonus: JSON.stringify({ defense: 12, speed: 8 }), price: 300, rarity: 'rare', required_level: 15, image_url: '/images/equipment/精灵长袍_ai.png' },
  { name: '玄冰重甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 35, speed: -5 }), price: 800, rarity: 'epic', required_level: 40, image_url: '/images/equipment/玄冰重甲_ai.png' },
  { name: '星光守护铠', slot: 'armor', stats_bonus: JSON.stringify({ defense: 50, attack: 5 }), price: 1500, rarity: 'legendary', required_level: 60, image_url: '/images/equipment/星光守护铠_ai.png' },
  { name: '皮帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 3 }), price: 80, rarity: 'common', required_level: 1, image_url: '/images/equipment/皮帽_ai.png' },
  { name: '铁盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8 }), price: 180, rarity: 'rare', required_level: 10, image_url: '/images/equipment/铁盔_ai.png' },
  { name: '学士帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 5, speed: 5 }), price: 300, rarity: 'epic', required_level: 20, image_url: '/images/equipment/学士帽_ai.png' },
  { name: '精灵王冠', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 10, speed: 5, attack: 5 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/精灵王冠_ai.png' },
  { name: '魔法头巾', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8, attack: 10 }), price: 400, rarity: 'rare', required_level: 25, image_url: '/images/equipment/魔法头巾_ai.png' },
  { name: '烈焰角盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 15, attack: 15 }), price: 900, rarity: 'legendary', required_level: 45, image_url: '/images/equipment/烈焰角盔_ai.png' },
  { name: '幸运项链', slot: 'accessory', stats_bonus: JSON.stringify({ crit_rate: 0.05 }), price: 150, rarity: 'rare', required_level: 5, image_url: '/images/equipment/幸运项链_ai.png' },
  { name: '力量戒指', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 8 }), price: 250, rarity: 'epic', required_level: 15, image_url: '/images/equipment/力量戒指_ai.png' },
  { name: '精灵护符', slot: 'accessory', stats_bonus: JSON.stringify({ speed: 15 }), price: 400, rarity: 'rare', required_level: 20, image_url: '/images/equipment/精灵护符_ai.png' },
  { name: '风暴之翼', slot: 'accessory', stats_bonus: JSON.stringify({ speed: 30, attack: 10 }), price: 1000, rarity: 'legendary', required_level: 50, image_url: '/images/equipment/风暴之翼_ai.png' },
  { name: '生命宝石', slot: 'accessory', stats_bonus: JSON.stringify({ defense: 15, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '/images/equipment/生命宝石_ai.png' },
  { name: '学霸眼镜', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 5, defense: 5, speed: 5 }), price: 300, rarity: 'rare', required_level: 10, image_url: '/images/equipment/学霸眼镜_ai.png' }
];

const insertEquipment = db.prepare('INSERT INTO equipment (name, slot, stats_bonus, price, rarity, required_level, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
equipment.forEach(e => insertEquipment.run(e.name, e.slot, e.stats_bonus, e.price, e.rarity, e.required_level, e.image_url));
console.log('   ✓ 装备数据初始化完成 (25件)');

// --- 技能 (答题战斗模式) ---
const skills = [
  { name: '普通攻击', description: '普通的物理攻击', icon: '⚔️', skill_type: 'physical', subject: null, base_damage: 50, base_defense: 0, base_speed: 0, cooldown: 0, required_level: 1, required_knowledge_point: null, required_accuracy: 0 },
  { name: '火焰冲击', description: '强力的火焰魔法', icon: '🔥', skill_type: 'magical', subject: '数学', base_damage: 80, base_defense: 0, base_speed: 0, cooldown: 2, required_level: 5, required_knowledge_point: '分数运算', required_accuracy: 0.6 },
  { name: '水炮', description: '高压水柱攻击', icon: '💧', skill_type: 'magical', subject: '语文', base_damage: 75, base_defense: 0, base_speed: 0, cooldown: 2, required_level: 5, required_knowledge_point: '阅读理解', required_accuracy: 0.6 },
  { name: '飞叶快刀', description: '快速的叶片攻击', icon: '🍃', skill_type: 'physical', subject: '英语', base_damage: 70, base_defense: 0, base_speed: 10, cooldown: 1, required_level: 3, required_knowledge_point: '单词拼写', required_accuracy: 0.5 },
  { name: '神圣之光', description: '神圣的光芒攻击', icon: '✨', skill_type: 'magical', subject: '科学', base_damage: 85, base_defense: 0, base_speed: 0, cooldown: 3, required_level: 8, required_knowledge_point: '光的折射', required_accuracy: 0.7 },
  { name: '暗影爪', description: '黑暗之爪攻击', icon: '🌑', skill_type: 'physical', subject: null, base_damage: 75, base_defense: 0, base_speed: 5, cooldown: 2, required_level: 5, required_knowledge_point: null, required_accuracy: 0 },
  { name: '铁壁防御', description: '大幅提升防御力', icon: '🛡️', skill_type: 'buff', subject: null, base_damage: 0, base_defense: 30, base_speed: 0, cooldown: 3, required_level: 3, required_knowledge_point: null, required_accuracy: 0 },
  { name: '疾风步', description: '大幅提升速度', icon: '💨', skill_type: 'buff', subject: null, base_damage: 0, base_defense: 0, base_speed: 30, cooldown: 3, required_level: 3, required_knowledge_point: null, required_accuracy: 0 },
  { name: '全力一击', description: '高威力但命中率低的攻击', icon: '💥', skill_type: 'physical', subject: null, base_damage: 120, base_defense: 0, base_speed: 0, cooldown: 4, required_level: 10, required_knowledge_point: null, required_accuracy: 0 }
];

const insertSkill = db.prepare('INSERT INTO skills (name, description, icon, skill_type, subject, base_damage, base_defense, base_speed, cooldown, required_level, required_knowledge_point, required_accuracy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
skills.forEach(s => insertSkill.run(s.name, s.description, s.icon, s.skill_type, s.subject, s.base_damage, s.base_defense, s.base_speed, s.cooldown, s.required_level, s.required_knowledge_point, s.required_accuracy));
console.log('   ✓ 技能数据初始化完成 (9个)');

// --- 成就 (100+个) ---
const achievements = [
  // 新手入门
  { name: '初入江湖', description: '创建第一只宠物', condition: JSON.stringify({ type: 'create_pet', count: 1 }), reward_type: 'gold', reward_value: 100 },
  { name: '初露锋芒', description: '宠物达到5级', condition: JSON.stringify({ type: 'pet_level', level: 5 }), reward_type: 'gold', reward_value: 150 },
  { name: '小有所成', description: '宠物达到10级', condition: JSON.stringify({ type: 'pet_level', level: 10 }), reward_type: 'item', reward_value: 3 },
  { name: '渐入佳境', description: '宠物达到15级', condition: JSON.stringify({ type: 'pet_level', level: 15 }), reward_type: 'gold', reward_value: 300 },
  { name: '崭露头角', description: '宠物达到20级', condition: JSON.stringify({ type: 'pet_level', level: 20 }), reward_type: 'item', reward_value: 5 },
  { name: '声名鹊起', description: '宠物达到25级', condition: JSON.stringify({ type: 'pet_level', level: 25 }), reward_type: 'gold', reward_value: 500 },
  { name: '一方霸主', description: '宠物达到30级', condition: JSON.stringify({ type: 'pet_level', level: 30 }), reward_type: 'item', reward_value: 8 },
  { name: '威震八方', description: '宠物达到40级', condition: JSON.stringify({ type: 'pet_level', level: 40 }), reward_type: 'gold', reward_value: 800 },
  { name: '登峰造极', description: '宠物达到50级', condition: JSON.stringify({ type: 'pet_level', level: 50 }), reward_type: 'item', reward_value: 10 },
  { name: '超凡入圣', description: '宠物达到60级', condition: JSON.stringify({ type: 'pet_level', level: 60 }), reward_type: 'gold', reward_value: 1000 },
  { name: '天下无敌', description: '宠物达到70级', condition: JSON.stringify({ type: 'pet_level', level: 70 }), reward_type: 'item', reward_value: 15 },
  { name: '传奇诞生', description: '宠物达到80级', condition: JSON.stringify({ type: 'pet_level', level: 80 }), reward_type: 'gold', reward_value: 2000 },
  { name: '神话降临', description: '宠物达到90级', condition: JSON.stringify({ type: 'pet_level', level: 90 }), reward_type: 'item', reward_value: 20 },
  { name: '满级成就', description: '宠物达到100级', condition: JSON.stringify({ type: 'pet_level', level: 100 }), reward_type: 'gold', reward_value: 5000 },
  // 经验积累
  { name: '初学乍练', description: '累计获得1000经验', condition: JSON.stringify({ type: 'total_exp', exp: 1000 }), reward_type: 'gold', reward_value: 100 },
  { name: '学有小成', description: '累计获得5000经验', condition: JSON.stringify({ type: 'total_exp', exp: 5000 }), reward_type: 'gold', reward_value: 200 },
  { name: '学有所成', description: '累计获得10000经验', condition: JSON.stringify({ type: 'total_exp', exp: 10000 }), reward_type: 'item', reward_value: 2 },
  { name: '学富五车', description: '累计获得50000经验', condition: JSON.stringify({ type: 'total_exp', exp: 50000 }), reward_type: 'gold', reward_value: 500 },
  { name: '博学多才', description: '累计获得100000经验', condition: JSON.stringify({ type: 'total_exp', exp: 100000 }), reward_type: 'item', reward_value: 5 },
  // 战斗相关
  { name: '首战告捷', description: '获得第一场战斗胜利', condition: JSON.stringify({ type: 'win_battle', count: 1 }), reward_type: 'gold', reward_value: 200 },
  { name: '战斗新手', description: '累计胜利10场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward_type: 'gold', reward_value: 300 },
  { name: '身经百战', description: '累计胜利50场', condition: JSON.stringify({ type: 'win_battle', count: 50 }), reward_type: 'item', reward_value: 3 },
  { name: '百战不殆', description: '累计胜利100场', condition: JSON.stringify({ type: 'win_battle', count: 100 }), reward_type: 'gold', reward_value: 800 },
  { name: '连胜新星', description: '获得3连胜', condition: JSON.stringify({ type: 'win_streak', count: 3 }), reward_type: 'gold', reward_value: 150 },
  { name: '连胜达人', description: '获得10连胜', condition: JSON.stringify({ type: 'win_streak', count: 10 }), reward_type: 'item', reward_value: 5 },
  { name: '首战失利', description: '经历第一次战败', condition: JSON.stringify({ type: 'lose_battle', count: 1 }), reward_type: 'gold', reward_value: 50 },
  // 作业相关
  { name: '作业新手', description: '完成第一次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward_type: 'gold', reward_value: 100 },
  { name: '作业达人', description: '完成50次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 50 }), reward_type: 'item', reward_value: 3 },
  { name: '作业大师', description: '完成200次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 200 }), reward_type: 'item', reward_value: 8 },
  { name: '优秀学生', description: '作业获得90分以上10次', condition: JSON.stringify({ type: 'high_score', count: 10, score: 90 }), reward_type: 'gold', reward_value: 500 },
  { name: '满分达人', description: '作业获得100分5次', condition: JSON.stringify({ type: 'perfect_score', count: 5 }), reward_type: 'gold', reward_value: 800 },
  // 社交相关
  { name: '认识新朋友', description: '添加1个好友', condition: JSON.stringify({ type: 'add_friends', count: 1 }), reward_type: 'gold', reward_value: 50 },
  { name: '社交达人', description: '添加10个好友', condition: JSON.stringify({ type: 'add_friends', count: 10 }), reward_type: 'item', reward_value: 3 },
  { name: '初次聊天', description: '发送第一条消息', condition: JSON.stringify({ type: 'send_message', count: 1 }), reward_type: 'gold', reward_value: 30 },
  // 收集相关
  { name: '初获装备', description: '获得第一件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 1 }), reward_type: 'gold', reward_value: 100 },
  { name: '装备收藏家', description: '收集10件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 10 }), reward_type: 'item', reward_value: 3 },
  // 登录相关
  { name: '首次登录', description: '第一天登录游戏', condition: JSON.stringify({ type: 'login', count: 1 }), reward_type: 'gold', reward_value: 50 },
  { name: '连续登录', description: '连续登录7天', condition: JSON.stringify({ type: 'continuous_login', days: 7 }), reward_type: 'item', reward_value: 2 },
  { name: '登录常客', description: '连续登录30天', condition: JSON.stringify({ type: 'continuous_login', days: 30 }), reward_type: 'item', reward_value: 5 },
  // 金币相关
  { name: '小有积蓄', description: '累计获得1000金币', condition: JSON.stringify({ type: 'total_gold', gold: 1000 }), reward_type: 'item', reward_value: 2 },
  { name: '富甲一方', description: '累计获得100000金币', condition: JSON.stringify({ type: 'total_gold', gold: 100000 }), reward_type: 'item', reward_value: 10 },
  // 每日任务
  { name: '每日任务初体验', description: '完成第一个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 1 }), reward_type: 'gold', reward_value: 50 },
  { name: '任务达人', description: '累计完成50个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 50 }), reward_type: 'gold', reward_value: 300 }
];

const insertAchievement = db.prepare('INSERT INTO achievements (name, description, condition, reward_type, reward_value) VALUES (?, ?, ?, ?, ?)');
achievements.forEach(a => insertAchievement.run(a.name, a.description, a.condition, a.reward_type, a.reward_value));
console.log('   ✓ 成就数据初始化完成 (' + achievements.length + '个)');

// --- 任务 ---
const tasks = [
  { type: 'daily', name: '每日签到', description: '每天登录游戏', condition: JSON.stringify({ type: 'login' }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
  { type: 'daily', name: '完成作业', description: '完成1次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward: JSON.stringify({ type: 'exp', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '进行战斗', description: '进行1次战斗', condition: JSON.stringify({ type: 'battle', count: 1 }), reward: JSON.stringify({ type: 'gold', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '拜访好友', description: '拜访3位好友', condition: JSON.stringify({ type: 'visit_friends', count: 3 }), reward: JSON.stringify({ type: 'gold', value: 80 }), reset_type: 'daily' },
  { type: 'weekly', name: '周任务-作业', description: '完成5次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 5 }), reward: JSON.stringify({ type: 'item', value: 2 }), reset_type: 'weekly' },
  { type: 'weekly', name: '周任务-战斗', description: '战斗胜利10场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward: JSON.stringify({ type: 'item', value: 3 }), reset_type: 'weekly' }
];

const insertTask = db.prepare('INSERT INTO tasks (type, name, description, condition, reward, reset_type) VALUES (?, ?, ?, ?, ?, ?)');
tasks.forEach(t => insertTask.run(t.type, t.name, t.description, t.condition, t.reward, t.reset_type));
console.log('   ✓ 任务数据初始化完成 (' + tasks.length + '个)');

// --- 论坛板块 ---
const forums = [
  { name: '综合讨论', description: '自由讨论区', icon: '💬', sort_order: 1 },
  { name: '学习交流', description: '学习心得分享', icon: '📚', sort_order: 2 },
  { name: '宠物攻略', description: '宠物养成技巧', icon: '🐾', sort_order: 3 },
  { name: '建议反馈', description: '产品建议与Bug反馈', icon: '💡', sort_order: 4 }
];

const insertForum = db.prepare('INSERT INTO forums (name, description, icon, sort_order) VALUES (?, ?, ?, ?)');
forums.forEach(f => insertForum.run(f.name, f.description, f.icon, f.sort_order));
console.log('   ✓ 论坛板块初始化完成 (' + forums.length + '个)');

console.log('');

// ============================================================
// 7. 创建用户
// ============================================================
console.log('7. 创建用户...\n');

async function createBasicUsers() {
  const saltRounds = 10;
  const password = '111111';
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run('admin', hashedPassword, 'admin@school.com', 'admin', 'active');
  console.log('   ✓ admin 创建成功');

  const teachers = [
    { username: 'teacher1', email: 'teacher1@school.com' },
    { username: 'teacher2', email: 'teacher2@school.com' }
  ];

  teachers.forEach(t => {
    db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run(t.username, hashedPassword, t.email, 'teacher', 'active');
    console.log(`   ✓ ${t.username} 创建成功`);
  });

  const students = [
    { username: 'student1', email: 'student1@school.com' }
  ];

  students.forEach(s => {
    db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run(s.username, hashedPassword, s.email, 'student', 'active');
    console.log(`   ✓ ${s.username} 创建成功`);
  });
}

async function createRichTestData() {
  const saltRounds = 10;
  const defaultPassword = '123456';
  const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

  // 学校
  const schoolResult = db.prepare('INSERT INTO schools (name, city, region) VALUES (?, ?, ?)').run('示范学校', '北京', '海淀区');
  const schoolId = schoolResult.lastInsertRowid;

  // 班级
  const classes = [
    { name: '高一(1)班', grade: '高一' },
    { name: '高一(2)班', grade: '高一' },
    { name: '高二(1)班', grade: '高二' }
  ];
  const insertClass = db.prepare('INSERT INTO classes (name, grade, school_id, student_count) VALUES (?, ?, ?, ?)');
  const classIds = [];
  classes.forEach(cls => {
    const result = insertClass.run(cls.name, cls.grade, schoolId, 0);
    classIds.push(result.lastInsertRowid);
  });

  // 教师
  const teachers = [
    { username: '张老师', email: 'zhang@school.com', role: 'teacher' },
    { username: '李老师', email: 'li@school.com', role: 'teacher' },
    { username: '王老师', email: 'wang@school.com', role: 'teacher' }
  ];
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, email, role, class_id, status) VALUES (?, ?, ?, ?, ?, ?)');
  const teacherIds = [];
  teachers.forEach((t, i) => {
    const result = insertUser.run(t.username, hashedPassword, t.email, t.role, classIds[i % classIds.length], 'active');
    teacherIds.push(result.lastInsertRowid);
  });

  // 设置班级教师
  const insertClassTeacher = db.prepare('INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, ?)');
  teacherIds.forEach((tid, i) => {
    insertClassTeacher.run(classIds[i % classIds.length], tid, i === 0 ? 'head_teacher' : 'teacher');
  });

  // 学生
  const studentNames = ['小明', '小红', '小刚', '小美', '小强', '小丽', '小军', '小芳', '小华', '小燕', '小伟', '小琳', '小超', '小娜', '小勇', '小婷'];
  const studentIds = [];
  studentNames.forEach((name, i) => {
    const classId = classIds[i % classIds.length];
    const result = insertUser.run(name, hashedPassword, `${name.toLowerCase()}@school.com`, 'student', classId, 'active');
    studentIds.push(result.lastInsertRowid);
  });

  // 宠物
  const species = db.prepare('SELECT id, name, element_type, base_stats FROM pet_species').all();
  const petNames = ['火球', '水滴', '叶子', '光芒', '暗影', '烈焰', '冰晶', '藤蔓', '圣光', '幽冥', '流星', '狂风', '雷霆', '熔岩', '森林', '深海'];
  const insertPet = db.prepare(`INSERT INTO pets (user_id, name, species_id, level, exp, hunger, mood, health, stamina, attack, defense, speed, crit_rate, growth_stage, friendship_points, win_count, total_battles, status, rebirth_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const petIds = [];
  studentIds.forEach((userId, i) => {
    const speciesIndex = i % species.length;
    const sp = species[speciesIndex];
    const baseStats = JSON.parse(sp.base_stats);
    const level = Math.floor(Math.random() * 30) + 1;
    const exp = Math.floor(Math.random() * level * 100);
    const attack = baseStats.attack + Math.floor(level * 1.5);
    const defense = baseStats.defense + Math.floor(level * 1.2);
    const speed = baseStats.speed + Math.floor(level * 1.3);
    const critRate = 0.05 + Math.random() * 0.15;
    const growthStageIndex = Math.min(Math.floor(level / 5), stages.length - 1);
    const growthStage = stages[growthStageIndex];
    const winCount = Math.floor(Math.random() * 50);
    const totalBattles = winCount + Math.floor(Math.random() * 30);
    const result = insertPet.run(userId, petNames[i], sp.id, level, exp, 50 + Math.floor(Math.random() * 50), 50 + Math.floor(Math.random() * 50), 50 + Math.floor(Math.random() * 50), 50 + Math.floor(Math.random() * 50), attack, defense, speed, critRate, growthStage, Math.floor(Math.random() * 1000), winCount, totalBattles, 'normal', 0);
    petIds.push(result.lastInsertRowid);
  });

  // 装备
  const equipments = db.prepare('SELECT id, slot, rarity FROM equipment').all();
  const insertUserEquipment = db.prepare('INSERT INTO user_equipment (user_id, equipment_id, equipped, level) VALUES (?, ?, ?, ?)');
  studentIds.forEach((userId) => {
    const slots = { weapon: null, armor: null, helmet: null, accessory: null };
    equipments.forEach(eq => {
      if (Math.random() > 0.3) {
        const equipped = slots[eq.slot] === null && Math.random() > 0.5;
        if (equipped) slots[eq.slot] = true;
        insertUserEquipment.run(userId, eq.id, equipped ? 1 : 0, Math.floor(Math.random() * 5) + 1);
      }
    });
  });

  // 物品
  const allItems = db.prepare('SELECT id FROM items').all();
  const insertUserItem = db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, ?)');
  studentIds.forEach(userId => {
    allItems.forEach(item => {
      if (Math.random() > 0.4) {
        insertUserItem.run(userId, item.id, Math.floor(Math.random() * 20) + 1);
      }
    });
  });

  // 作业
  const assignmentData = [
    { title: '数学练习-第一章', subject: '数学', description: '完成课本第1-10页的练习', max_exp: 100, question_type: '选择题', questions: JSON.stringify([{ id: 1, question: '1+1=?', options: ['1', '2', '3', '4'], answer: '2' }, { id: 2, question: '2×3=?', options: ['5', '6', '7', '8'], answer: '6' }]) },
    { title: '语文作文-我的理想', subject: '语文', description: '写一篇关于我的理想的作文', max_exp: 150, question_type: '作文' },
    { title: '英语单词测试', subject: '英语', description: '默写本周学习的20个单词', max_exp: 80, question_type: '默写' }
  ];
  const insertAssignment = db.prepare(`INSERT INTO assignments (teacher_id, title, description, subject, question_type, questions, max_exp, status, class_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const assignmentIds = [];
  assignmentData.forEach((a, i) => {
    const result = insertAssignment.run(teacherIds[i % teacherIds.length], a.title, a.description, a.subject, a.question_type, a.questions || null, a.max_exp, 'active', classIds[i % classIds.length]);
    assignmentIds.push(result.lastInsertRowid);
  });

  // 提交
  const insertSubmission = db.prepare(`INSERT INTO submissions (assignment_id, user_id, answers, status, ai_score, teacher_score, exp_reward, gold_reward, total_score, total_max_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  studentIds.forEach(userId => {
    assignmentIds.forEach(assignmentId => {
      if (Math.random() > 0.3) {
        const aiScore = 60 + Math.random() * 40;
        const teacherScore = 55 + Math.random() * 45;
        const status = Math.random() > 0.2 ? 'graded' : 'submitted';
        insertSubmission.run(assignmentId, userId, JSON.stringify({ answer: '学生答案' }), status, status === 'graded' ? aiScore : null, status === 'graded' ? teacherScore : null, status === 'graded' ? Math.floor(aiScore) : 0, status === 'graded' ? Math.floor(aiScore / 2) : 0, status === 'graded' ? aiScore : null, 100);
      }
    });
  });

  // 战斗
  const insertBattle = db.prepare(`INSERT INTO battles (pet1_id, pet2_id, winner_id, battle_type, reward_exp, reward_gold, battle_log) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 0; i < 30; i++) {
    const idx1 = Math.floor(Math.random() * petIds.length);
    let idx2 = Math.floor(Math.random() * petIds.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * petIds.length);
    const winnerId = Math.random() > 0.5 ? petIds[idx1] : petIds[idx2];
    insertBattle.run(petIds[idx1], petIds[idx2], winnerId, 'pvp', Math.floor(Math.random() * 100) + 50, Math.floor(Math.random() * 200) + 100, JSON.stringify({ rounds: Math.floor(Math.random() * 5) + 1 }));
  }

  // 好友
  const insertFriend = db.prepare('INSERT INTO friends (user_id, friend_id, friendship_level, status) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < studentIds.length; i++) {
    for (let j = i + 1; j < studentIds.length; j++) {
      if (Math.random() > 0.5) {
        insertFriend.run(studentIds[i], studentIds[j], Math.floor(Math.random() * 5) + 1, 'active');
        insertFriend.run(studentIds[j], studentIds[i], Math.floor(Math.random() * 5) + 1, 'active');
      }
    }
  }

  // 公告
  const insertAnnouncement = db.prepare(`INSERT INTO announcements (class_id, publisher_id, title, content, priority) VALUES (?, ?, ?, ?, ?)`);
  const announcementData = [
    { title: '新学期开始', content: '欢迎同学们回到学校，新的学期让我们一起努力！', priority: 1 },
    { title: '宠物对战大赛', content: '第一届班级宠物对战大赛即将开始，请大家积极参与！', priority: 2 },
    { title: '作业提交提醒', content: '请同学们按时完成作业，不要忘记提交哦~', priority: 0 }
  ];
  announcementData.forEach((ann, i) => {
    insertAnnouncement.run(classIds[i % classIds.length], teacherIds[i % teacherIds.length], ann.title, ann.content, ann.priority);
  });

  console.log('\n   测试数据创建完成！');
  console.log('   所有账号密码: 123456');
}

if (useTestData) {
  createRichTestData().then(() => {
    console.log('\n✅ 数据库初始化完成！（含丰富测试数据）');
    console.log(`   共创建 ${db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").get().cnt} 张表`);
    db.close();
  });
} else {
  createBasicUsers().then(() => {
    console.log('\n✅ 数据库初始化完成！');
    console.log(`   共创建 ${db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").get().cnt} 张表`);
    console.log('\n========================================');
    console.log('基础账号信息：');
    console.log('========================================');
    console.log('管理员: admin (密码: 111111)');
    console.log('教师: teacher1, teacher2 (密码: 111111)');
    console.log('学生: student1 (密码: 111111)');
    console.log('========================================');
    console.log('\n提示: 使用 --test-data 参数可创建丰富测试数据');
    db.close();
  });
}
