/**
 * 纸质扫描照片：额外存一份小缩略图
 *
 * 背景：登记界面的网格只有几十像素一格，却要从服务端拉几百 KB 的原图。
 * 一个班几十张照片，光是"给老师看一眼缩略图"就要下载十几 MB，
 * 而原图体积对识别有意义（判分要看手写），对预览毫无意义。
 *
 * 做法：前端在上传时顺便生成一张长边 320 的小图（复用已解码的画布，
 * 不多解码一次），随原图一起上传。列表/网格一律读这张小图。
 *
 * 字段说明：
 *   thumb_path  缩略图文件名（与 file_path 同目录 data/uploads/paper-scan/）
 *   thumb_size  缩略图体积，用于界面展示"省了多少流量"
 *
 * 老照片没有这两列的值，读取接口会回退到原图，功能不退化。
 */

const ADD_COLUMN = (table, column, type) => `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;

exports.up = async function (knex) {
  // 用 ALTER ADD COLUMN 而非重建表：已有批次与照片记录必须保留。
  // 重复执行会报「duplicate column name」，说明列已存在，忽略即可。
  const attempt = async (sql) => {
    try {
      await knex.raw(sql);
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (!/duplicate column name|already exists/i.test(msg)) throw e;
    }
  };

  await attempt(ADD_COLUMN('paper_scan_images', 'thumb_path', 'TEXT'));
  await attempt(ADD_COLUMN('paper_scan_images', 'thumb_size', 'INTEGER'));
};

exports.down = async function () {
  // SQLite 不支持 DROP COLUMN（老版本会直接报错），
  // 回滚整库时走的是「删表重建」，不依赖这里。
};
