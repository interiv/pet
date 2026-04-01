const { db } = require('./src/config/database');

console.log('Starting database migration...');

try {
  // Check submissions table columns
  const columns = db.prepare("PRAGMA table_info(submissions)").all();
  let hasGoldReward = false;
  let hasDroppedItem = false;
  
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].name === 'gold_reward') hasGoldReward = true;
    if (columns[i].name === 'dropped_item') hasDroppedItem = true;
  }

  if (!hasGoldReward) {
    console.log('Adding gold_reward column...');
    db.prepare("ALTER TABLE submissions ADD COLUMN gold_reward INTEGER DEFAULT 0").run();
    console.log('gold_reward column added successfully');
  } else {
    console.log('gold_reward column already exists');
  }

  if (!hasDroppedItem) {
    console.log('Adding dropped_item column...');
    db.prepare("ALTER TABLE submissions ADD COLUMN dropped_item TEXT").run();
    console.log('dropped_item column added successfully');
  } else {
    console.log('dropped_item column already exists');
  }

  // Check users table for gold column
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  let hasGold = false;
  
  for (let i = 0; i < userColumns.length; i++) {
    if (userColumns[i].name === 'gold') hasGold = true;
  }

  if (!hasGold) {
    console.log('Adding gold column to users table...');
    db.prepare("ALTER TABLE users ADD COLUMN gold INTEGER DEFAULT 0").run();
    console.log('gold column added successfully');
  } else {
    console.log('gold column already exists');
  }

  console.log('\nDatabase migration completed!');
} catch (error) {
  console.error('Database migration failed:', error);
}
