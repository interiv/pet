/**
 * 作答照片额外保存一份小缩略图
 *
 * 背景：学生上传手写作答照片后，作答页面上只用一个 200px 宽的预览图
 * （`<Image width={200}>`），但 src 指向的是长边 2000 的原图——
 * 一张几百 KB，为了看一眼缩略图就整张下载，和纸质扫描改造前一模一样。
 *
 * 做法：前端上传时顺手生成一张长边 320 的小图（复用已解码的画布，
 * 不多解码一次），随原图一起上传，预览一律读这张小图。
 *
 * 字段说明：
 *   thumb_path  缩略图的可访问路径（与 file_path 同格式：/uploads/<文件名>）
 *   thumb_size  缩略图体积，便于排查"缩略图没生效"这类问题
 *
 * 老数据这两列为空，读取时回退原图，功能不退化。
 */

const ADD_COLUMN = (table, column, type) => `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;

exports.up = async function (knex) {
  // 用 ALTER ADD COLUMN 而非重建表：已经上传过的作答照片记录必须保留。
  // 重复执行会报「duplicate column name」，说明列已存在，忽略即可。
  const attempt = async (sql) => {
    try {
      await knex.raw(sql);
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (!/duplicate column name|already exists/i.test(msg)) throw e;
    }
  };

  await attempt(ADD_COLUMN('upload_files', 'thumb_path', 'TEXT'));
  await attempt(ADD_COLUMN('upload_files', 'thumb_size', 'INTEGER'));
};

exports.down = async function () {
  // SQLite 老版本不支持 DROP COLUMN，整体重置走的是「删表重建」，不依赖这里
};
