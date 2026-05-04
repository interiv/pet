#!/bin/sh
set -e

DB_PATH="/app/data/database.sqlite"

if [ -f "$DB_PATH" ]; then
  HAS_TABLE=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$DB_PATH');
    const row = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='users'\").get();
    db.close();
    console.log(row ? 'yes' : 'no');
  ")
  if [ "$HAS_TABLE" = "yes" ]; then
    echo "数据库已初始化，跳过建表"
  else
    echo "数据库文件存在但无表结构，执行初始化..."
    node scripts/init_db.js
  fi
else
  echo "数据库文件不存在，执行初始化..."
  node scripts/init_db.js
fi

exec npm start
