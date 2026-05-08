async function execRaw(knex, sql) {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await knex.raw(stmt);
  }
}

exports.up = async function (knex) {
  await knex.raw(`PRAGMA journal_mode = WAL`);
  await knex.raw(`PRAGMA foreign_keys = ON`);

  await execRaw(knex, `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'student',
      class_id INTEGER,
      avatar TEXT,
      gold INTEGER DEFAULT 0,
      total_gold_earned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      status TEXT DEFAULT 'active'
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE class_teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      role TEXT DEFAULT 'teacher',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, teacher_id),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER,
      publisher_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);

  await execRaw(knex, `
    CREATE TABLE pet_species (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      element_type TEXT,
      base_stats TEXT,
      growth_rate REAL DEFAULT 1.0,
      unlock_condition TEXT,
      image_urls TEXT,
      description TEXT
    )
  `);

  await execRaw(knex, `
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
      total_exp_earned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (species_id) REFERENCES pet_species(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE user_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE user_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      equipment_id INTEGER NOT NULL,
      equipped INTEGER DEFAULT 0,
      obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      level INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
      grade_level TEXT,
      tags TEXT,
      estimated_time INTEGER DEFAULT 60,
      default_score REAL DEFAULT 5,
      is_public INTEGER DEFAULT 1,
      review_status TEXT DEFAULT 'approved',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      updated_at DATETIME
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      question_bank_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      score_weight REAL DEFAULT 1.0,
      FOREIGN KEY (assignment_id) REFERENCES assignments(id),
      FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'daily',
      name TEXT NOT NULL,
      description TEXT,
      condition TEXT,
      reward TEXT,
      reset_type TEXT DEFAULT 'daily',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      tasks_completed INTEGER DEFAULT 0,
      total_tasks INTEGER DEFAULT 5,
      streak_days INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      condition TEXT,
      reward_type TEXT,
      reward_value INTEGER,
      category TEXT DEFAULT 'special',
      icon TEXT DEFAULT '🏆',
      sort_order INTEGER DEFAULT 0
    )
  `);

  await execRaw(knex, `
    CREATE TABLE user_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      achievement_id INTEGER NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (achievement_id) REFERENCES achievements(id),
      UNIQUE(user_id, achievement_id)
    )
  `);

  await execRaw(knex, `
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
      FOREIGN KEY (assignment_id) REFERENCES assignments(id),
      UNIQUE(user_id, question_id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE gold_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      gold_change INTEGER NOT NULL,
      reason TEXT,
      source TEXT DEFAULT 'system',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE user_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      activity_type TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE forum_thread_tags (
      thread_id INTEGER NOT NULL,
      tag_name TEXT NOT NULL,
      PRIMARY KEY (thread_id, tag_name),
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
    )
  `);

  await execRaw(knex, `
    CREATE TABLE forum_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(thread_id, user_id),
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE forum_post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE forum_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(thread_id, user_id),
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
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
      max_questions_per_user INTEGER DEFAULT 20,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await execRaw(knex, `
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
    )
  `);

  await execRaw(knex, `
    CREATE TABLE boss_battle_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boss_battle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value INTEGER NOT NULL,
      claimed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(boss_battle_id, user_id, reward_type)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE boss_battle_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boss_battle_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      UNIQUE(boss_battle_id, question_id),
      FOREIGN KEY (boss_battle_id) REFERENCES boss_battles(id),
      FOREIGN KEY (question_id) REFERENCES question_bank(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE boss_battle_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boss_battle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      is_correct INTEGER DEFAULT 0,
      answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(boss_battle_id, user_id, question_id),
      FOREIGN KEY (boss_battle_id) REFERENCES boss_battles(id),
      FOREIGN KEY (question_id) REFERENCES question_bank(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE boss_battle_reward_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boss_battle_id INTEGER NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value INTEGER NOT NULL,
      FOREIGN KEY (boss_battle_id) REFERENCES boss_battles(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE ai_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_name TEXT NOT NULL,
      model_type TEXT,
      api_endpoint TEXT,
      api_key TEXT,
      parameters TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await execRaw(knex, `
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await execRaw(knex, `
    CREATE TABLE ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_type TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, report_type),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('gold', 'item', 'equipment', 'exp', 'mystery')),
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      batch_id INTEGER,
      class_id INTEGER,
      created_by INTEGER NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_by INTEGER,
      used_at DATETIME,
      expires_at DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES card_batches(id),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE card_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('gold', 'item', 'equipment', 'exp', 'mystery')),
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      quantity INTEGER NOT NULL,
      class_id INTEGER,
      created_by INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE card_redemption_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (card_id) REFERENCES cards(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE classroom_quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      class_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE classroom_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id)
    )
  `);

  await execRaw(knex, `
    CREATE TABLE classroom_quiz_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_id INTEGER,
      student_id INTEGER NOT NULL,
      pet_id INTEGER,
      reward_type TEXT NOT NULL CHECK(reward_type IN ('gold', 'item', 'equipment', 'exp')),
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      reason TEXT,
      awarded_by INTEGER NOT NULL,
      awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id),
      FOREIGN KEY (question_id) REFERENCES classroom_quiz_questions(id),
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (awarded_by) REFERENCES users(id)
    )
  `);

  await execRaw(knex, `
    CREATE INDEX idx_qb_variant_group ON question_bank(variant_group_id);
    CREATE INDEX idx_qb_subject ON question_bank(subject);
    CREATE INDEX idx_qb_type ON question_bank(type);
    CREATE INDEX idx_qb_difficulty ON question_bank(difficulty);
    CREATE INDEX idx_qb_knowledge_point ON question_bank(knowledge_point);
    CREATE INDEX idx_qb_grade_level ON question_bank(grade_level);
    CREATE INDEX idx_qb_is_public ON question_bank(is_public);
    CREATE INDEX idx_qb_created_by ON question_bank(created_by);
    CREATE INDEX idx_aq_assignment ON assignment_questions(assignment_id);
    CREATE INDEX idx_aq_question ON assignment_questions(question_bank_id);
    CREATE INDEX idx_qa_submission ON question_answers(submission_id);
    CREATE INDEX idx_qa_question ON question_answers(question_bank_id);
    CREATE INDEX idx_friend_requests_sender ON friend_requests(sender_id, status);
    CREATE INDEX idx_friend_requests_receiver ON friend_requests(receiver_id, status);
    CREATE INDEX idx_friends_status ON friends(user_id, status);
    CREATE INDEX idx_gold_transactions_user ON gold_transactions(user_id);
    CREATE INDEX idx_gold_transactions_created ON gold_transactions(created_at);
    CREATE INDEX idx_user_activities_user ON user_activities(user_id);
    CREATE INDEX idx_user_activities_created ON user_activities(created_at);
    CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX idx_notifications_type ON notifications(user_id, type, created_at DESC);
    CREATE INDEX idx_posts_user ON posts(user_id, created_at DESC);
    CREATE INDEX idx_posts_class ON posts(class_id, created_at DESC);
    CREATE INDEX idx_posts_scope ON posts(scope, created_at DESC);
    CREATE INDEX idx_post_likes ON post_likes(post_id, user_id);
    CREATE INDEX idx_post_comments ON post_comments(post_id, created_at ASC);
    CREATE INDEX idx_chat_messages_room ON chat_messages(room_type, room_id, created_at ASC);
    CREATE INDEX idx_chat_messages_private ON chat_messages(user_id, target_user_id, created_at ASC);
    CREATE INDEX idx_forum_threads_forum ON forum_threads(forum_id, status, last_reply_at DESC);
    CREATE INDEX idx_forum_threads_class_id ON forum_threads(class_id);
    CREATE INDEX idx_forum_posts_thread ON forum_posts(thread_id, created_at ASC);
    CREATE INDEX idx_boss_class ON boss_battles(class_id, status);
    CREATE INDEX idx_boss_participant ON boss_battle_participants(boss_battle_id, user_id);
    CREATE INDEX idx_boss_rewards ON boss_battle_rewards(boss_battle_id, user_id);
    CREATE UNIQUE INDEX idx_classes_slug ON classes(slug);
    CREATE INDEX idx_posts_class_id ON posts(class_id);
    CREATE INDEX idx_cards_code ON cards(code);
    CREATE INDEX idx_cards_batch ON cards(batch_id);
    CREATE INDEX idx_cards_created_by ON cards(created_by);
    CREATE INDEX idx_cards_class ON cards(class_id);
    CREATE INDEX idx_card_batches_created ON card_batches(created_by);
    CREATE INDEX idx_card_redemption_user ON card_redemption_logs(user_id);
    CREATE INDEX idx_classroom_quizzes_class ON classroom_quizzes(class_id);
    CREATE INDEX idx_classroom_quiz_rewards_quiz ON classroom_quiz_rewards(quiz_id);
    CREATE INDEX idx_classroom_quiz_rewards_student ON classroom_quiz_rewards(student_id)
  `);

  await execRaw(knex, `
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
};

exports.down = async function (knex) {
  await knex.raw(`DROP VIEW IF EXISTS knowledge_point_accuracy`);

  const tables = [
    'classroom_quiz_rewards', 'classroom_quiz_questions', 'classroom_quizzes',
    'card_redemption_logs', 'cards', 'card_batches',
    'ai_reports', 'settings', 'ai_configs',
    'boss_battle_reward_config', 'boss_battle_answers', 'boss_battle_questions',
    'boss_battle_rewards', 'boss_battle_participants', 'boss_battles',
    'notifications',
    'forum_favorites', 'forum_post_likes', 'forum_likes',
    'forum_thread_tags', 'forum_posts', 'forum_threads', 'forums',
    'chat_read_status', 'chat_messages',
    'post_comments', 'post_likes', 'posts',
    'user_activities', 'gold_transactions',
    'knowledge_point_stats', 'wrong_questions',
    'user_achievements', 'achievements',
    'daily_task_logs', 'daily_tasks', 'user_tasks', 'tasks',
    'friend_requests', 'friends',
    'upload_files',
    'question_answers', 'submissions',
    'assignment_questions', 'assignments',
    'question_bank',
    'battles',
    'pet_skills', 'skills',
    'user_equipment', 'equipment',
    'user_items', 'items',
    'pets', 'pet_species',
    'announcements',
    'class_invitations', 'class_applications', 'class_teachers', 'classes',
    'schools', 'users',
  ];

  for (const table of tables) {
    await knex.raw(`DROP TABLE IF EXISTS ${table}`);
  }
};
