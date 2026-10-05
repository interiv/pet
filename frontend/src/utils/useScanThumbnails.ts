/**
 * 扫描照片的缩略图加载
 *
 * 为什么不直接用 <img src="/api/...">：
 * 照片接口走 Authorization 头校验（学生的作答不能当公开资源暴露），
 * 而 img 标签带不上请求头，只能拿到 401。所以必须 fetch 成blob 再给 img 用。
 *
 * 为什么要缓存：网格里每张照片会因重渲染反复出现，每次都重新下载
 * 既慢又浪费带宽。objectURL 不会自动释放，集中 revoke 一次即可。
 *
 * 取的是 /thumb（长边 320，十几 KB）而不是 /file（原图，几百 KB）：
 * 网格格子只有几十像素，拉原图纯属白下流量，一个班就是十几 MB。
 *
 * 调用方只传「已上传」的照片 id：还没传完的占位记录服务端必然 404，
 * 早问一遍只是白白刷一屏红色报错。
 */
import { useEffect, useRef, useState } from 'react';
import { assignmentAPI } from './api';

/** 单张图的失败重试上限：够cover「上传刚完成、文件刚写好」的时序抖动 */
const MAX_ATTEMPTS = 3;
/** 重试间隔：太短会立刻再失败，太长老师会觉得图刷不出来 */
const RETRY_DELAY_MS = 2000;

export function useScanThumbnails(assignmentId: number, batchId: number | undefined, imageIds: number[]) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const cache = useRef(new Map<number, string>());
  /** 每张图失败过几次——不计数会无限重试，一张真正丢失的图能刷一整晚请求 */
  const attempts = useRef(new Map<number, number>());
  /** 重试触发器：改一下就重新跑一遍 effect */
  const [retryTick, setRetryTick] = useState(0);
  // 组件卸载或换批次时把上一次生成的 URL 全部释放，避免内存泄漏
  const cacheRef = useRef(cache.current);
  const idsKey = imageIds.join(',');

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const missing = imageIds.filter((id) => id > 0 && !cache.current.has(id));
    if (!batchId || missing.length === 0) return undefined;

    (async () => {
      // 并发但限量：一次几十张全开会把浏览器连接占满，反而更慢
      const CONCURRENCY = 4;
      let failed = 0;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        if (cancelled) return;
        const slice = missing.slice(i, i + CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        const loaded = await Promise.all(slice.map(async (id) => {
          try {
            const u = await assignmentAPI.fetchScanThumb(assignmentId, batchId as number, id);
            return [id, u] as const;
          } catch (e) {
            attempts.current.set(id, (attempts.current.get(id) || 0) + 1);
            return null;
          }
        }));
        loaded.forEach((kv) => { if (kv) cache.current.set(kv[0], kv[1]); });
        if (!cancelled) setUrls(Object.fromEntries(cache.current));
        failed += loaded.filter((kv) => !kv).length;
      }
      /**
       * 失败自动重试。
       *
       * 曾经的表现是：照片一传完就去取，服务端还没写完整，一次 404 之后就
       * 再也不试了（依赖没变，effect 不会再跑），网格永远留白，
       * 老师只能切到别的学生再切回来才看得到——纯靠运气。
       * 这里失败后过两秒自动重来，最多 3 次。
       */
      if (!cancelled && failed > 0) {
        const canRetry = missing.some((id) => (attempts.current.get(id) || 0) < MAX_ATTEMPTS);
        if (canRetry) retryTimer = setTimeout(() => setRetryTick((t) => t + 1), RETRY_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, batchId, idsKey, retryTick]);

  useEffect(() => () => {
    cacheRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
    cacheRef.current.clear();
  }, []);

  return (imageId: number) => urls[imageId];
}
