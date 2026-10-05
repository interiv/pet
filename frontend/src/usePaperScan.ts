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
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { assignmentAPI } from './utils/api';
import { compressImagesBlobs, formatSize } from './utils/imageCompress';

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
 *   - 'single'：单人登记。每次开新批次、用完即弃，
 *     否则会误复用批量扫描的批次，把别人的照片混进这个学生名下
 * @param options.initialGroupSize 批量模式下的初始「每人张数」；单人模式固定按一份卷子处理
 */
export function usePaperScan(
  assignmentId: number,
  enabled: boolean,
  options: { mode?: 'batch' | 'single'; initialGroupSize?: number } = {}
) {
  const mode = options.mode || 'batch';
  // 单人登记只服务一个学生，所有照片必须落在同一组里，
  // 所以分组数直接顶到上限（1~10 张都算一份卷子）
  const fixedGroupSize = mode === 'single';
  const [batch, setBatch] = useState<ScanBatch | null>(null);
  const [groupSize, setGroupSize] = useState(
    fixedGroupSize ? 10 : Math.max(1, Math.min(10, options.initialGroupSize || 1))
  );
  /**
   * 本地待上传的文件：key 是指纹，顺序即展示顺序。
   *
   * imageId 是这张文件在服务端对应的那条记录（补占位后拿到的）。
   * 必须记住它、不能靠下标去猜：本地列表和服务端images 一旦不同步
   * （删了但删除请求失败、草稿恢复后重新选的文件顺序不同），
   * 按下标取会张冠李戴，把甲的文件传到乙的记录上。
   *
   * blob 是压缩后的内容（不是原始 File）：手机随手一拍3~5MB，
   * 一次扫半个班上百兆，原图全存在内存里会直接把标签页搞崩。
   * 压缩后每张几百 KB，几十张也才十几兆。
   * originalSize 留个原始体积，只用于给用户看「已从3.2MB 压到 420KB」。
   */
  const [pendingFiles, setPendingFiles] = useState<Array<{
    key: string; file: File; blob: Blob; originalSize: number;
    uploaded: boolean; percent: number; imageId?: number; error?: string;
  }>>([]);
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
      // 复用到的批次可能属于批量扫描，混进来会导致照片张冠李戴
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
      // 服务端已有记录的照片按「文件名 + 大小」认回来。
      // 浏览器不允许程序读取 File 路径，刷新后只能靠用户重新选一次同一批文件，
      // 这时若认不回就会全部重传一遍几百 MB，得不偿失。
      const serverByName = new Map<string, ScanImage>();
      for (const img of batch?.images || []) {
        if (!img.file_name || !img.file_size) continue;
        serverByName.set(`${img.file_name}|${img.file_size}`, img);
      }

      // 服务端已传过的跳过压缩：内容已经在服务器上了，压一遍是白费 CPU
      const fresh = files.filter((f) => !serverByName.get(`${f.name}|${f.size}`)?.uploaded);
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
          const hit = serverByName.get(`${f.name}|${f.size}`);
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
    const r = await assignmentAPI.createScanBatch(assignmentId, groupSize);
    setBatch(r.data.batch);
    return r.data.batch as ScanBatch;
  }, [batch, assignmentId, groupSize]);

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
      const b = await ensureBatch();
      const bid = b.batch_id;
      let ok = 0;
      let fail = 0;

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
          // 传压缩后的 blob，不是原图：手机原图 3~5MB，压完几百 KB
          await assignmentAPI.uploadScanImage(assignmentId, bid, imageId, item.blob, (percent) => {
            setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, percent } : p)));
          });
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, uploaded: true, percent: 100, error: undefined } : p)));
          ok += 1;
        } catch (e: any) {
          fail += 1;
          setPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, error: e?.response?.data?.error || '上传失败' } : p)));
        }
      }

      const fresh = await refresh(bid);
      if (fail > 0) {
        message.warning(`上传完成：成功 ${ok} 张，失败 ${fail} 张。失败的可重新选择文件后再传`);
      } else {
        message.success(`已上传 ${ok} 张照片，可以开始 AI 识别了`);
      }
      if (fresh) saveDraft({ batchId: bid, assignmentId, fingerprints: pendingFiles.map((p) => p.key), groupSize, savedAt: Date.now() }, assignmentId);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [pendingFiles, ensureBatch, assignmentId, groupSize, refresh]);
  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

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
    if (!b?.batch_id || b.scan_status === 'running') {
      message.warning('识别中不能删除照片');
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
  };
}
