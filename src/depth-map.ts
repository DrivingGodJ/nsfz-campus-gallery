export const loadImageElement = (url: string, message = '图片加载失败。') => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(message));
  image.src = url;
});
