# NAS 主存储

审核应用的程序和 Git 工作区留在本机。启用 NAS 主存储后，照片、私有原片、草稿、标注和恢复备份直接保存在 NAS 的 `nsfz-campus-gallery` 内容库；本机只保留程序、模型组件和发布所需的小型索引。

- 浏览照片通过本机服务读取 NAS，响应使用 `Cache-Control: no-store`。
- 导入和保存直接写 NAS。NAS 未连接时停止读写并明确提示，避免产生第二份内容库。
- “下载照片”主动建立本地副本。之后的保存会更新本地标注，新增照片、深度图和移除操作会同步更新副本。未点击下载时不会建立本地照片目录。
- “清理本地照片”先校验 NAS 副本，再清理本机缓存，保留程序与索引。
- 打开上线面板只读取内容索引。发布时核对本次变更，从 NAS 向图片备份库和 Cloudflare 上传，不补齐整套本地照片。完整代码测试继续由 GitHub 发布流程执行，本机仍检查内容构建和点赞服务配置。

首次启用前退出审核应用并连接 NAS，在源码目录运行：

```sh
node scripts/nas-primary-setup.mjs '/完整路径/审核应用工作区' --config '/完整路径/nas.json'
```

配置文件格式为 `{"archiveRoot":"/Volumes/工程/归档目录"}`。迁移只需一次：先同步并独立校验已有内容，再清理已核验的本地副本，最后记录 NAS 模式。中断或冲突时保留未完成的数据，不强制覆盖。

Cloudflare 的已有文件清单缓存在 NAS 的 `.local/media-hosting.json`。首次建立清单只读取在线文件头和 NAS 文件大小，不下载整套照片；以后直接复用清单。上传凭据通过已安装 Wrangler 的 `auth token --json` 读取，仅在进程内使用，不写入工程或日志。发布前需保持 Wrangler 已登录。

接口依据：[Cloudflare Static Assets Direct Upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/)。
