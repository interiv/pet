/**
 * 扫描照片的缩略图加载
 *
 * 为什么不直接用 <img src="/api/...">：
 * 照片接口走 Authorization 头校验（学生的作答不能当公开资源暴露），
 * 而 img 标签带不上请求头，只能拿到 401。所以必须 fetch 成blob 再给 img 用。
 *
 * 为什么要缓存：网格里每张照片会因重渲染反复出现，每次都重新下载
 * 既慢又浪费带宽。objectURL 不会自动释放，集中 revoke 一次即可。
 */
import { useEffect, useRef, useState } from 'react';
import { assignmentAPI } from './api';

export function useScanThumbnails(assignmentId: number, batchId: number | undefined, imageIds: number[]) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const cache = useRef(new Map<number, string>());
  // 组件卸载或换批次时把上一次生成的 URL 全部释放，避免内存泄漏
  const cacheRef = useRef(cache.current);

  useEffect(() => {
    let cancelled = false;
    const missing = imageIds.filter((id) => id > 0 && !cache.current.has(id));
    if (!batchId || missing.length === 0) return undefined;

    (async () => {
      // 并发但限量：一次几十张全开会把浏览器连接占满，反而更慢
      const CONCURRENCY = 4;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        if (cancelled) return;
        const slice = missing.slice(i, i + CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        const loaded = await Promise.all(slice.map(async (id) => {
          try {
            const u = await assignmentAPI.fetchScanImage(assignmentId, batchId as number, id);
            return [id, u] as const;
          } catch (e) {
            return null;
          }
        }));
        loaded.forEach((kv) => { if (kv) cache.current.set(kv[0], kv[1]); });
        if (!cancelled) setUrls(Object.fromEntries(cache.current));
      }
    })();

    return () => { cancelled = true; };
  }, [assignmentId, batchId, imageIds.join(',')]);

  useEffect(() => () => {
    cacheRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
    cacheRef.current.clear();
  }, []);

  return (imageId: number) => urls[imageId];
}
