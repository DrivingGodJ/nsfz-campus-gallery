export const externalPhotoDownload = (url: string, pageURL: string) => new URL(url, pageURL).origin !== new URL(pageURL).origin;

export async function downloadPhotoFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('下载失败，请检查网络后重试。');
  const objectURL = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = objectURL; link.download = filename;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  }
}
