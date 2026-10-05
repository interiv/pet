/**
 * 纸质作业扫描（批次制）的状态与操作封装
 *
 * 为什么要单独抽出来：批量扫描组件原本把「选图 / 压缩 / 识别 / 登记」全塞在一个文件里，
 * 状态一多就难以维护。这里把批次生命周期收敛到一处，组件只管渲染。
 *
 * 关键能力：
 *   - 断点续传：照片先登记占位再逐张上传，中断后已传的不重传
 *   - 关窗不影响：进度与结果都在后端，重开组件能接着看
 *   - 取消不是回滚：停止识别但保留已识别部分
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { assignmentAPI } from './utils/api';
import { compressImagesBlobs, formatSize } from './utils/imageCompress';

/** 本地待上传的一张照片 */
export interface PendingFile {
  /** 指纹（文件名|大小|修改时间），用于去重 */
  key: string;
  file: File;
  /** 压缩后的内容（上传用的是它，不是原图） */
  blob: Blob;
  /** 压缩前的原始体积，用于提示「已从 3.2MB 压到 420KB」 */
  originalSize: number;
  uploaded: boolean;
  percent: number;
  /** 在服务端对应的记录 id，补占位后拿到；靠它而不是下标定位 */
  imageId?: number;
  /** 这一张的失败原因 */
  error?: string;
}

export interface ScanImage {
  image_id: number;
  group_no: number;
  seq: number;
  uploaded: boolean;
  file_name: string;
  file_size: number;
  status: string;
  student_id: number | null;
  raw_name: string;
}

export interface ScanBatch {
  batch_id: number;
  group_size: number;
  upload_status: string;
  scan_status: string;
  total_images: number;
  uploaded_images: number;
  pending_images: number;
  total_groups: number;
  scanned_groups: number;
  result: { papers?: any[]; model?: string } | null;
  error: string | null;
  /** 本次识别用的模型名，可能为空 */
  model?: string | null;
  /** 这个批次是为哪个学生扫的；null/缺省表示批量扫描（装着全班） */
  student_id?: number | null;
  /** 成绩是否已登记（写入 submissions）；区分「已识别」与「已登记」 */
  registered?: boolean;
  registered_at?: string | null;
  images: ScanImage[];
}

/** 本地草稿：File 不能存 localStorage，只存指纹用于重新选文件时匹配回来 */
interface Draft {
  batchId: number;
  assignmentId: number;
  /** fileName|size|lastModified 的指纹，顺序与 images 一致 */
  fingerprints: string[];
  groupSize: number;
  savedAt: number;
}

const DRAFT_KEY = (assignmentId: number) => `paper_scan_draft_${assignmentId}`;

export const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** 同一浏览器只保留一个作业的草稿，换作业时自动覆盖 */
function saveDraft(d: Draft | null, assignmentId: number) {
  const key = DRAFT_KEY(assignmentId);
  try {
    if (d) localStorage.setItem(key, JSON.stringify(d));
    else localStorage.removeItem(key);
  } catch (e) { /* 隐私模式下写不了，忽略 */ }
}

export function readDraft(assignmentId: number): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(assignmentId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/**
 * 扫描流程控制器
 *
 * @param assignmentId 作业 id
 * @param enabled弹窗是否打开（关闭时停止轮询，但不影响后端任务）
 */
/**
 * 扫描流程控制器
 *
 * @param assignmentId 作业 id
 * @param enabled 弹窗是否打开
 * @param options.mode
 *   - 'batch'（默认）：批量扫描。会复用上次没传完的批次，关窗再打开能接着传
 *   - 'single'：单人登记。一个学生一个批次，切学生会切到那个学生自己的批次，
 *     避免两个人的照片混进同一份卷子
 * @param options.studentId 单人模式下当前处理的学生。切换它会切批次。
 * @param options.initialGroupSize 批量模式下的初始「每人张数」
 */
export function usePaperScan(
  assignmentId: number,
  enabled: boolean,
  options: { mode?: 'batch' | 'single'; studentId?: number | null; initialGroupSize?: number } = {}
) {
  const mode = options.mode || 'batch';
  const studentId = options.studentId ?? null;
  // 单人登记只服务一个学生，所有照片必须落在同一组里，
  // 所以分组数直接顶到上限（1~10 张都算一份卷子）
  const fixedGroupSize = mode === 'single';
  const [batch, setBatch] = useState<ScanBatch | null>(null);
  const [groupSize, setGroupSize] = useState(
    fixedGroupSize ? 10 : Math.max(1, Math.min(10, options.initialGroupSize || 1))
  );
  /**
   * 本地待上传的文件，**按学生 id 分开存放**。
   *
   * 为什么不用单个数组 + 切学生时存档/恢复：
   * 那样要维护两份状态（当前视图 + 存档），切来切去容易漏同步。
   * 直接按 student_id 分桶，每个学生一份，天然隔离——
   * 老师给 A 选好 3 张、切去 B 选 2 张、再切回 A，3 张还在。
   * 批量模式 studentId 为 null，统一起落到 null 桶，行为与从前一致。
   *
   * 字段说明：
   *   key     指纹（文件名|大小|修改时间），去重用
   *   blob    压缩后的内容。手机随手一拍 3~5MB，一次扫半个班上百兆，
   *           原图全存内存会把标签页搞崩；压完每张几百 KB
   *   imageId 这张在服务端对应的那条记录。必须记住、不能靠下标去猜：
   *           本地与服务端不同步时会张冠李戴，把甲的文件传到乙的记录上
   */
  //键是学生 id；批量模式用 'batch' 兜底。用Map 语义更直白，
  // 避免 Record<number | string, T> 这种混合键类型在索引签名上报错
  const [filesByStudent, setFilesByStudent] = useState<Map<number | 'batch', PendingFile[]>>(() => new Map());
  // 批量模式没有 studentId，统一落到 'batch' 桶，行为与从前一致
  const bucketKey: number | 'batch' = (mode === 'single' && studentId) ? studentId : 'batch';
  const pendingFiles = filesByStudent.get(bucketKey) || [];

  /** 写当前学生的照片列表 */
  const setPendingFiles = useCallback((updater: PendingFile[] | ((prev: PendingFile[]) => PendingFile[])) => {
    const key = bucketKey;
    setFilesByStudent((prevAll) => {
      const next = new Map(prevAll);
      const cur = next.get(key) || [];
      const updated = typeof updater === 'function' ? updater(cur) : updater;
      next.set(key, updated);
      return next;
    });
  }, [bucketKey]);

  /**
   * 每个学生「本机已选但还没上传」的张数。
   *
   * 左侧列表要靠它显示「选N」标记，而且**不只当前选中的学生**要显示——
   * 老师给 A 选完照片切去 B，A 名字后面的「选1」必须还在，
   * 否则看起来就像照片丢了。照片按学生分桶存，这里直接从各桶统计。
   */
  const pendingCountByStudent = useMemo(() => {
    const out: Record<number, number> = {};
    filesByStudent.forEach((list, key) => {
      if (key === 'batch') return;
      const n = (list || []).filter((f) => !f.uploaded).length;
      if (n > 0) out[key as number] = n;
    });
    return out;
  }, [filesByStudent]);

  const [compressing, setCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollTimer = useRef<any>(null);

  /** 拉取批次最新状态 */
  const refresh = useCallback(async (batchId?: number) => {
    const id = batchId || batch?.batch_id;
    if (!id) return null;
    try {
      const r = await assignmentAPI.getScanBatch(assignmentId, id);
      setBatch(r.data.batch);
      return r.data.batch as ScanBatch;
    } catch (e) {
      return null;
    }
  }, [assignmentId, batch?.batch_id]);

  /** 打开弹窗时：恢复上次的批次（含进度与结果），没有则准备一个空批次 */
  const init = useCallback(async () => {
    setLoading(true);
    try {
      // 单人模式不查历史、每次从空批次开始：
      // 单人登记：不查批量扫描的批次列表。
      // 批次由「ensureBatch」按当前 studentId 惰性创建或复用，
      // 这样切学生时才有机会换成另一个学生的批次。
      if (mode === 'single') {
        setBatch(null);
        setPendingFiles([]);
        setGroupSize(10);
        saveDraft(null, assignmentId);
        return;
      }
      const r = await assignmentAPI.listScanBatches(assignmentId);
      const list: ScanBatch[] = r.data.batches || [];
      //优先用「还有照片没传完」或「正在识别」的批次，没有才新建
      const reusable = list.find((b) => b.upload_status !== 'uploaded' || b.scan_status === 'running' || b.scan_status === 'cancelled');
      if (reusable) {
        setBatch(reusable);
        setGroupSize(reusable.group_size || 1);
        setPendingFiles([]);
      } else {
        setBatch(null);
        setPendingFiles([]);
      }
      saveDraft(readDraft(assignmentId) && reusable ? readDraft(assignmentId) : null, assignmentId);
    } catch (e) {
      message.error('加载扫描批次失败');
    } finally {
      setLoading(false);
    }
  }, [assignmentId, mode]);

  // 弹窗打开时恢复现场
  useEffect(() => {
    if (enabled) init();
    else stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, assignmentId]);
  /**
   * 选择照片：先在客户端压缩，再放进本地列表，不立刻上传。
   *
   * 压缩放在这里而不是上传时，是有意为之：
   * 一旦把原图存进 state，选 30 张就是 100MB+ 内存，移动端浏览器会直接崩。
   * 压完只留几百 KB 的 Blob，几十张也才十几兆。
   * 老师仍然可以先在本地整理（删掉拍错的、调顺序），确认无误再点上传。
   */
  const pickFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;
    setCompressing(true);
    setCompressProgress({ done: 0, total: files.length });
    try {
      // 认回服务端已有的照片，避免重传。
      // 浏览器不允许程序读取 File 路径，刷新后只能靠用户重新选一次同一批文件，
      // 认不回就会把这批照片全部重传一遍，手机上等于白等几十分钟。
      //
      // 只能按「文件名」认，不能带大小：服务端 file_size 记的是**压缩后**的体积
      // （服务端据此判断单张是否超限），而本地 f.size 是原图体积，
      // 3MB 原图对300KB 压缩结果是永远配不上，认回会静默失效。
      // 同名的可能有几张（两台手机拍的照片都叫 IMG_0001.jpg），
      // 所以按出现顺序一一配对，且同一条服务端记录只认领一次。
      const byName = new Map<string, ScanImage[]>();
      for (const img of batch?.images || []) {
        if (!img.file_name) continue;
        const arr = byName.get(img.file_name);
        if (arr) arr.push(img);
        else byName.set(img.file_name, [img]);
      }
      const claimed = new Set<number>();
      const matchServer = (name: string): ScanImage | undefined => {
        const arr = byName.get(name);
        if (!arr) return undefined;
        for (const img of arr) {
          if (claimed.has(img.image_id)) continue;
          claimed.add(img.image_id);
          return img;
        }
        return undefined;
      };
      // 先统一匹配一次并记下结果：matchServer 有「认领」副作用，
      // 每个文件只能调一次，否则后面取结果时顺序不同会配错。
      const hits = new Map<string, ScanImage | undefined>();
      files.forEach((f) => { hits.set(fingerprint(f), matchServer(f.name)); });

      // 服务端已传过的跳过压缩：内容已经在服务器上了，压一遍是白费 CPU
      const fresh = files.filter((f) => !hits.get(fingerprint(f))?.uploaded);
      const skipped = files.length - fresh.length;

      const compressed = await compressImagesBlobs(
        fresh.map((f) => ({ file: f, key: fingerprint(f) })),
        { onProgress: (d) => setCompressProgress({ done: skipped + d, total: files.length }) }
      );
      const blobByKey = new Map(compressed.map((c) => [c.key, c]));

      setPendingFiles((prev) => {
        const exist = new Set(prev.map((p) => p.key));
        const added: typeof prev = [];
        files.forEach((f) => {
          const key = fingerprint(f);
          if (exist.has(key)) return;
          const hit = hits.get(key);
          const c = blobByKey.get(key);
          added.push({
            key,
            file: f,
            blob: c?.blob || f,
            originalSize: f.size,
            uploaded: Boolean(hit?.uploaded),
            percent: hit?.uploaded ? 100 : 0,
            imageId: hit?.image_id,
          });
        });
        return [...prev, ...added];
      });

      const saved = compressed.reduce((sum, c) => sum + (c.originalSize - c.blob.size), 0);
      if (saved > 0) {
        message.success(`已压缩 ${files.length} 张，体积减少 ${formatSize(saved)}，上传会快很多`);
      }
    } catch (e: any) {
      message.error(e?.message || '图片压缩失败');
    } finally {
      setCompressing(false);
      setCompressProgress(null);
    }
  }, [batch?.images]);

  /** 确保有一个批次（第一次上传时才创建，避免空批次堆积） */
  const ensureBatch = useCallback(async () => {
    if (batch?.batch_id) return batch;
    // 单人登记把student_id 传上去，后端会为这个学生复用未完成的批次；
    // 不传则建成批量批次（装着全班）。
    const r = mode === 'single' && studentId
      ? await assignmentAPI.createScanBatch(assignmentId, groupSize, studentId)
      : await assignmentAPI.createScanBatch(assignmentId, groupSize);
    setBatch(r.data.batch);
    return r.data.batch as ScanBatch;
  }, [batch, assignmentId, groupSize, mode, studentId]);

  /**
   * 逐张上传。未上传成功的会标 error，下次可以只重传这些。
   * 中途关掉的话，已经传成功的在服务端有记录，重开能接着传。
   */
  const uploadAll = useCallback(async () => {
    if (pendingFiles.length === 0) {
      message.info('请先添加照片');
      return;
    }
    setUploading(true);
    try {
      let b = await ensureBatch();
      /**
       * 防御：批次必须属于当前学生。
       *
       * 切学生是异步的（setCurrentStudent 先变、批次随后才取回），
       * 如果老师切得急、或在批次取回前就点了上传，
       * 这里可能拿到的是上一位学生的批次——照片就会传到别人名下。
       * 与其事后排查「照片怎么跑到别人那里了」，不如当场拦住。
       */
      if (mode === 'single' && studentId && b.student_id !== studentId) {
        const r = await assignmentAPI.createScanBatch(assignmentId, groupSize, studentId);
        b = r.data.batch;
        setBatch(b);
      }
      const bid = b.batch_id;
      let ok = 0;
      let fail = 0;
      // 逐张收集失败原因，最后汇总展示；只报「失败 N 张」等于什么都没说
      const reasons: string[] = [];

      for (let i = 0; i < pendingFiles.length; i += 1) {
        const item = pendingFiles[i];
        // 已经传过的跳过（断点续传）。判断依据是本地记住的 imageId，
        // 不是「服务端第 i 张」——下标对齐在增删不同步时会传错文件。
        if (item.imageId && item.uploaded) {
          ok += 1;
          continue;
        }
        // 没有占位记录就先补一个，服务端才知道「这张待传」
        let imageId = item.imageId;
        if (!imageId) {
          const meta = await assignmentAPI.addScanImageMeta(assignmentId, bid, {
            // 登记压缩后的实际体积：服务端据此判断单张是否超限
            file_name: item.file.name,
            file_size: item.blob.size,
            mime_type: 'image/jpeg',
          });
          imageId = meta.data.image_id;
          b.images = meta.data.batch.images;
          // 立刻记住，避免下一轮循环或再次打开时又去猜
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, imageId } : p)));
        }
        if (imageId === undefined) {
          fail += 1;
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, error: '未能为这张照片建立记录，请重试' } : p)));
          continue;
        }
        try {
          // 传压缩后的 blob，不是原图：手机原图 3~5MB，压完几百 KB。
          // 第三个参数是真实文件名：写死会让服务端把所有照片的 file_name
          // 都记成同一个名字，之后刷新页面就认不回哪张是哪张。
          await assignmentAPI.uploadScanImage(assignmentId, bid, imageId, item.blob, item.file.name, (percent) => {
            setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, percent } : p)));
          });
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, uploaded: true, percent: 100, error: undefined } : p)));
          ok += 1;
        } catch (e: any) {
          fail += 1;
          const reason = e?.response?.data?.error
            || (e?.code === 'ECONNABORTED' ? '上传超时，请检查网络' : '')
            || (e?.message || '上传失败');
          reasons.push(reason);
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, error: reason } : p)));
        }
      }

      const fresh = await refresh(bid);
      if (fail > 0) {
        // 必须把真实原因带出来。原来只说「失败 N 张」，老师完全不知道
        // 是网络断了、功能开关关了、还是文件超限——只能干瞪眼重试。
        const uniq = [...new Set(reasons)];
        message.warning(
          `上传完成：成功 ${ok} 张，失败 ${fail} 张。` +
          (uniq.length ? `失败原因：${uniq.slice(0, 2).join('；')}` : '')
        );
      } else {
        message.success(`已上传 ${ok} 张照片，可以开始 AI 识别了`);
      }
      if (fresh) saveDraft({ batchId: bid, assignmentId, fingerprints: pendingFiles.map((p) => p.key), groupSize, savedAt: Date.now() }, assignmentId);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [pendingFiles, ensureBatch, assignmentId, groupSize, refresh, mode, studentId]);
  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /**
   * 切换到另一个学生（单人登记用）。
   *
   * 换人时必须调用：结束当前批次的轮询、清掉批次视图，
   * 再按新学生的 studentId 去服务端取回「他已经传过的照片与识别结果」。
   * 不这么做，两个人的照片会落进同一个批次，
   * 被当成一份卷子送去 AI 识别——两份卷面混在一起。
   *
   * 注意这里**不碰本地照片**：它们按学生分桶存放，
   * 切走时留着，切回来自动读回该学生的桶（见 filesByStudent）。
   */
  const switchStudent = useCallback(async (nextStudentId: number | null) => {
    if (mode !== 'single') return;
    stopPolling();
    setScanning(false);
    setBatch(null);
    setCompressing(false);
    setCompressProgress(null);
    if (!nextStudentId) return null;
    try {
      // 后端返回该学生最近的批次（可能是已登记过的那个）。
      // 这样老师登记后追加照片重拍，会接在原批次上，旧照片不会丢。
      const r = await assignmentAPI.createScanBatch(assignmentId, 10, nextStudentId);
      setBatch(r.data.batch);
      return r.data.batch as ScanBatch;
    } catch (e: any) {
      // 取不到就先不建批次，等老师点上传时再试
      message.error(e?.response?.data?.error || '加载该学生的扫描进度失败');
      return null;
    }
  }, [assignmentId, mode, stopPolling]);

  /**
   * 拉一次「所有正在识别的学生」的进度。
   *
   * 存在的理由：识别是在服务端后台跑的，老师完全可以在 A 识别期间
   * 去上传 B、C、D。但轮询当前批次的逻辑会在切学生时停掉，
   * 于是「A 识别完了」这个消息老师永远收不到。
   * 组件层用这个方法做一次轻量轮询（只查汇总，不查单个批次），
   * 保证「谁在识别、谁识别完了」始终是最新的。
   */
  const refreshAllProgress = useCallback(async () => {
    try {
      const r = await assignmentAPI.getScanStudentProgress(assignmentId);
      return r.data.progress || [];
    } catch (e) {
      return [];
    }
  }, [assignmentId]);

  /** 识别进度轮询：进度在服务端，这里只负责读 */
  const startPolling = useCallback((batchId: number) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      const b = await refresh(batchId);
      if (!b) return;
      if (b.scan_status === 'done' || b.scan_status === 'failed' || b.scan_status === 'cancelled') {
        stopPolling();
        setScanning(false);
        if (b.scan_status === 'done') {
          const n = (b.result?.papers || []).length;
          message.success(`识别完成，共 ${n} 份卷面`);
        } else if (b.scan_status === 'cancelled') {
          message.info(`已停止识别，完成 ${b.scanned_groups}/${b.total_groups} 组`);
        } else {
          message.error(b.error || '识别失败');
        }
      }
    }, 1500);
  }, [refresh, stopPolling]);

  /** 开始识别（后台跑，可关窗） */
  const startScan = useCallback(async (restart?: 'all') => {
    if (!batch?.batch_id) {
      message.info('请先上传照片');
      return;
    }
    if (batch.uploaded_images < batch.total_images) {
      message.warning(`还有 ${batch.pending_images} 张未上传，请先补齐或删掉它们`);
      return;
    }
    try {
      await assignmentAPI.startScan(assignmentId, batch.batch_id, restart);
      setScanning(true);
      setBatch(await refresh(batch.batch_id));
      startPolling(batch.batch_id);
      message.info('识别已在后台开始，可以关掉弹窗，稍后回来看结果');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '启动识别失败');
    }
  }, [batch, assignmentId, refresh, startPolling]);

  /** 取消：停止识别，已识别部分保留 */
  const cancelScan = useCallback(async () => {
    if (!batch?.batch_id) return;
    try {
      const r = await assignmentAPI.cancelScan(assignmentId, batch.batch_id);
      setBatch(r.data.batch);
      message.success(r.data.message || '已停止识别');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '取消失败');
    }
  }, [batch, assignmentId]);

  /** 续跑：只识别没成功的组 */
  const resumeScan = useCallback(async () => {
    if (!batch?.batch_id) return;
    try {
      await assignmentAPI.resumeScan(assignmentId, batch.batch_id);
      setScanning(true);
      setBatch(await refresh(batch.batch_id));
      startPolling(batch.batch_id);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '续跑失败');
    }
  }, [batch, assignmentId, refresh, startPolling]);

  /** 改「每人几张」，服务端会重新编组 */
  const changeGroupSize = useCallback(async (n: number) => {
    // 单人登记只有一位学生，改分组会把照片打散成多份卷子，没有意义
    if (fixedGroupSize) return;
    setGroupSize(n);
    if (!batch?.batch_id) return;
    if (batch.scan_status === 'running') {
      message.warning('识别中不能调整分组，请先停止');
      return;
    }
    try {
      const r = await assignmentAPI.setScanGroupSize(assignmentId, batch.batch_id, n);
      setBatch(r.data.batch);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '调整分组失败');
    }
  }, [batch, assignmentId, fixedGroupSize]);

  /** 调整顺序：待上传列表本地重排，已上传的同步给服务端 */
  const moveImage = useCallback(async (from: number, to: number) => {
    if (from === to) return;
    setPendingFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    if (!batch?.batch_id || batch.scan_status === 'running') return;
    // 未上传的还没有image_id，只能等上传后再排；这里只同步已上传部分的相对顺序
    const uploadedIds = (batch.images || []).filter((i) => i.uploaded).map((i) => i.image_id);
    if (uploadedIds.length < 2) return;
    // 注意是「先移除再插入」。写成 splice(from, 0) 会在原位多插一个，
    // 同一个 image_id 出现两次，服务端按这个顺序重排后顺序就乱了。
    const ordered = [...uploadedIds];
    const [moved] = ordered.splice(from, 1);
    if (moved === undefined) return;
    ordered.splice(to, 0, moved);
    try {
      const r = await assignmentAPI.reorderScanImages(assignmentId, batch.batch_id, ordered);
      setBatch(r.data.batch);
    } catch (e) { /* 顺序同步失败不阻塞上传 */ }
  }, [batch, assignmentId]);
  /** 删掉一张（服务端记录 + 磁盘文件一起删） */
  const removeImage = useCallback(async (index: number) => {
    const b = batch;
    // 识别中不能删：照片正在被 AI 读取，删了会导致这组识别结果对不上
    if (b?.batch_id && b.scan_status === 'running') {
      message.warning('正在识别中，请先停止识别再删除照片');
      return;
    }
    // 没有批次 = 照片还在本地（没上传过），直接从本地列表移除即可。
    // 原先这里和「识别中」共用一句提示，导致刚选完还没上传时
    // 删照片也报「识别中不能删除」，与实际情况完全不符。
    if (!b?.batch_id) {
      setPendingFiles((prev) => prev.filter((_, idx) => idx !== index));
      return;
    }
    // 用本地记住的 imageId，而不是 batch.images[index]：
    // 服务端列表里可能还有本地已移除、但删除请求失败的记录，下标会错位
    const target = pendingFiles[index];
    const imageId = target?.imageId;
    if (imageId) {
      try {
        const r = await assignmentAPI.deleteScanImage(assignmentId, b.batch_id, imageId);
        setBatch(r.data.batch);
      } catch (e: any) {
        message.error(e?.response?.data?.error || '删除失败');
        return;
      }
    }
    setPendingFiles((prev) => prev.filter((_, idx) => idx !== index));
  }, [batch, assignmentId, pendingFiles]);

  /** 丢弃整个批次（连同已上传的文件） */
  const discardBatch = useCallback(async () => {
    if (!batch?.batch_id) {
      setPendingFiles([]);
      setBatch(null);
      saveDraft(null, assignmentId);
      return;
    }
    if (batch.scan_status === 'running') {
      message.warning('识别中无法删除，请先停止识别');
      return;
    }
    try {
      await assignmentAPI.deleteScanBatch(assignmentId, batch.batch_id);
      setBatch(null);
      setPendingFiles([]);
      saveDraft(null, assignmentId);
      message.success('已清空本次扫描');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '清空失败');
    }
  }, [batch, assignmentId]);

  // 组件卸载时停掉轮询，避免内存泄漏
  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    batch, setBatch,
    groupSize,
    pendingFiles,
    uploading,
    scanning,
    loading,
    /** 正在客户端压缩照片（此时还占着 CPU，别让用户以为界面死了） */
    compressing,
    /** 压缩进度 { done, total } */
    compressProgress,
    pickFiles,
    uploadAll,
    startScan,
    cancelScan,
    resumeScan,
    changeGroupSize,
    moveImage,
    removeImage,
    discardBatch,
    refresh,
    /** 单人登记：切换学生（会换成那个学生自己的批次） */
    switchStudent,
    /** 单人登记：拉所有学生的进度（用于后台识别监视） */
    refreshAllProgress,
    /** 单人登记：每个学生本机已选未上传的张数（左侧「选N」标记） */
    pendingCountByStudent,
  };
}
