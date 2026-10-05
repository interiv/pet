/**
 * 拍照上传前的客户端压缩
 *
 * 为什么必须在客户端压缩：
 * 手机随手一拍就是 3~5MB，一份卷子 2~3 张、一次扫半个班就是上百兆。
 * 服务器带宽有限，压完再传能把上传时间降一个数量级，
 * 而且服务端存的也是小图，磁盘和后续读取都受益。
 *
 * 为什么返回 Blob 而不是 dataURL（base64）：
 * base64 比原始二进制大 33%，一张 300KB 的图会变成 400KB。
 * 上传时 FormData 直接收Blob，没有理由先转成 base64 再传出去。
 *
 * 三个容易踩的坑，这里都处理了：
 *  1. 手机竖拍照片靠 EXIF 方向信息显示，忽略它会存成躺着的图——
 *     createImageBitmap 的 imageOrientation 让方向在解码时就摆正。
 *  2. 只压一次不一定够：极端情况下（比如截图 + 高质量设置）压完还超标，
 *     所以要有体积兜底，逐级降质量重试。
 *  3. 压完反而更大（小图本来就很小）就用原图，不要越压越大。
 *
 * 顺带产出一张长边 320 的缩略图（见 compressImageWithThumb）：
 * 登记网格每格只有几十像素，之前却要从服务端拉几百 KB 的原图，
 * 一个班白下十几 MB。缩略图复用刚解好的画布缩一张，
 * 上传时一起传上去，之后网格读的就是这十几 KB 的小图。
 */

/** 视觉模型对分辨率不敏感，超过这个尺寸再大也不会更准，只是白费带宽 */
const DEFAULT_MAX_SIDE = 2000;
const DEFAULT_QUALITY = 0.82;
/** 单张体积上限：超过就降质量重试 */
const DEFAULT_MAX_BYTES = 900 * 1024;
/** 质量下限：再压也认不清手写，低于这个值不如让用户重拍 */
const MIN_QUALITY = 0.6;

/**
 * 网格缩略图的长边。
 *
 * 登记界面里的照片格只有 60~80 px，320 已经足够清晰；
 * 再大就是给浏览器白下几倍的像素。整张约 10~25KB，
 * 一个班 30 张合计几百 KB，而拉原图是十几 MB。
 */
export const THUMB_MAX_SIDE = 320;
/** 缩略图质量：小图压缩损失肉眼看不出来，0.7 足够 */
export const THUMB_QUALITY = 0.7;

export interface CompressOptions {
  /** 长边上限（px），默认 2000 */
  maxSide?: number;
  /** JPEG 质量，默认 0.82 */
  quality?: number;
  /** 体积上限（字节），超出会降质量重试，默认 900KB */
  maxBytes?: number;
  /** 进度回调，用于在 UI 上显示「正在压缩 3/10」 */
  onProgress?: (done: number, total: number) => void;
  /** 是否同时产出一张网格缩略图，默认 true（compressImageBlob 内部传 false） */
  withThumb?: boolean;
  /** 缩略图长边（px），默认 320 */
  thumbMaxSide?: number;
}

/** 解码成HTMLCanvasElement（已按 EXIF 摆正方向） */
async function drawToCanvas(blob: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  // 优先 createImageBitmap：能直接读 EXIF 方向，且比 <img> 解码快
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      }
      bmp.close?.();
      return canvas;
    } catch (e) {
      // Safari 老版本可能不认imageOrientation，落到下面的 <img> 方案
    }
  }

  // 回退：<img> 在现代浏览器里 drawImage 时也会自动应用 EXIF 方向
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解码失败'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))),
      'image/jpeg',
      quality
    );
  });

/**
 * 在已经解码好的画布上缩出一张小图。
 *
 * 为什么复用外部传进来的画布，而不是拿着原图再解码一遍：
 * 手机上解码一张 4000px 的照片要几百毫秒、几十 MB 内存，
 * 为了一张缩略图再解一次，选 30 张就会多卡十几秒。
 */
function downscaleCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  // 原图本来就比缩略图还小，直接复用，省一次重编码
  if (scale >= 1) return canvas;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = small.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, small.width, small.height);
  }
  return small;
}

/**
 * 压缩单张图片，并（默认）同时产出一张网格预览用的小缩略图。
 *
 * @returns blob 上传用的正文；thumb 缩略图（生成失败为 null，调用方回退用原图预览）
 */
export async function compressImageWithThumb(
  input: Blob,
  options: CompressOptions = {}
): Promise<{ blob: Blob; thumb: Blob | null }> {
  const maxSide = options.maxSide || DEFAULT_MAX_SIDE;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const thumbMaxSide = options.thumbMaxSide ?? THUMB_MAX_SIDE;
  const wantThumb = options.withThumb !== false && thumbMaxSide > 0;
  let quality = options.quality || DEFAULT_QUALITY;

  const canvas = await drawToCanvas(input, maxSide);

  // 逐级降质量直到达标；每降一档重新编码，体积通常降得很快
  let out = await canvasToBlob(canvas, quality);
  while (out.size > maxBytes && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.1);
    out = await canvasToBlob(canvas, quality);
  }

  // 压完反而更大（小图/已高度压缩的图）就用原图，别越压越大
  if (input.size > 0 && out.size >= input.size) out = input;

  let thumb: Blob | null = null;
  if (wantThumb) {
    try {
      const small = downscaleCanvas(canvas, thumbMaxSide);
      thumb = await canvasToBlob(small, THUMB_QUALITY);
      if (small !== canvas) {
        small.width = 0;
        small.height = 0;
      }
    } catch (e) {
      // 缩略图生成失败不能挡住上传：没有它只是台账网格要回退去拉原图，多花点流量
      thumb = null;
    }
  }

  // 大图上 canvas 内存占用不小，尽早释放
  canvas.width = 0;
  canvas.height = 0;
  return { blob: out, thumb };
}

/**
 * 压缩单张图片。
 * @returns JPEG Blob；若原图已经很小且压不动，会原样返回（类型可能不是 JPEG）
 */
export async function compressImageBlob(input: Blob, options: CompressOptions = {}): Promise<Blob> {
  const r = await compressImageWithThumb(input, { ...options, withThumb: false });
  return r.blob;
}

/**
 * 批量压缩，逐张进行。
 *
 * 刻意不并行：一次处理十几张会在手机上把主线程占死，界面直接卡住。
 * 串行反而体感更稳，而且能逐张汇报进度。
 *
 * 默认连缩略图一起产出（withThumb 传 false 可关掉）：画布已经解好，
 * 顺手缩一张几乎不额外花时间，却能让登记网格少下十几 MB。
 */
export async function compressImagesBlobs(
  files: Array<{ file: File; key: string }>,
  options: CompressOptions = {}
): Promise<Array<{ key: string; blob: Blob; originalSize: number; thumb?: Blob }>> {
  const out: Array<{ key: string; blob: Blob; originalSize: number; thumb?: Blob }> = [];
  for (let i = 0; i < files.length; i += 1) {
    const { file, key } = files[i];
    try {
      const r = await compressImageWithThumb(file, options);
      out.push({ key, blob: r.blob, thumb: r.thumb || undefined, originalSize: file.size });
    } catch (e) {
      // 单张失败不阻断整批，退回原图让用户至少能传
      out.push({ key, blob: file, originalSize: file.size });
    }
    options.onProgress?.(i + 1, files.length);
  }
  return out;
}

/** 人类可读的体积文案 */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};
