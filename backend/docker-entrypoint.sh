#!/bin/sh
set -e

DB_PATH="/app/data/database.sqlite"

echo "=== 执行数据库迁移 ==="
npx knex migrate:latest --knexfile knexfile.js --env production

if [ -f "$DB_PATH" ]; then
  HAS_USERS=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$DB_PATH');
    const row = db.prepare(\"SELECT COUNT(*) as cnt FROM users\").get();
    db.close();
    console.log(row.cnt > 0 ? 'yes' : 'no');
  ")
  if [ "$HAS_USERS" = "yes" ]; then
    echo "数据库已有数据，跳过种子数据填充"
  else
    echo "数据库为空，执行种子数据填充..."
    npx knex seed:run --knexfile knexfile.js --env production
  fi
else
  echo "数据库文件不存在，执行种子数据填充..."
  npx knex seed:run --knexfile knexfile.js --env production
fi

echo "=== 启动服务 ==="
exec npm start
