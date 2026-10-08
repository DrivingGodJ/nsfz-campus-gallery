export function assetURL(file: string, baseURL: string, mediaBaseURL = '', development = false) {
  return file.startsWith('media/') && mediaBaseURL && !development
    ? mediaBaseURL.replace(/\/+$/, '') + '/' + file
    : baseURL + file;
}
