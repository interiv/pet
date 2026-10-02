/**
 * 纸质作业拍照上传前的压缩：长边最大 1600px，JPEG 85%。
 * 视觉模型对分辨率不敏感，压缩后能显著降低上传耗时与 token 消耗。
 */
export function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxSide) { height = Math.round((height * maxSide) / width); width = maxSide; }
        else if (height > maxSide) { width = Math.round((width * maxSide) / height); height = maxSide; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
