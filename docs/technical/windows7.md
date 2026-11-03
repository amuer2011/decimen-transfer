# Windows 7 SP1 x64

目标系统：Windows 7 6.1.7601 Service Pack 1，64 位。常规 Windows 包使用 Electron 40；本通道固定 Electron 22.3.27 / Chromium 108，前端构建目标为 chrome108。

## 构建

在现代 Windows 和 Node.js 22+ 上运行：

```powershell
npm ci
npm test
npm run desktop:win7
```

产物在 `artifacts/desktop/win7/Decimen.Optical.Transfer-v<version>-win7-x64.exe`。用户无需 Node.js。配置为 `desktop/electron-builder.win7.yml`，继承路径相对项目根目录。Win7 使用独立名称、appId 与输出目录，避免与常规版本的用户配置混淆。

## GitHub Actions

独立工作流 **Win7 Desktop**（`.github/workflows/win7-desktop.yml`）：

- 手动运行：可指定 ref，留空则使用所选分支/tag；默认仅上传构建 artifact。
- 手动填写 `release_tag`：将构建产物附加到该 Release。
- 推送 `v*` tag：构建后自动附加到同名 Release。

构建 job 只有读取权限；发布 job 单独授予写入权限。发布前检查 portable EXE、真正应用 EXE 的 x64 PE 头、app.asar 和应用实际报告的 Electron 版本，并生成 SHA256SUMS-win7.txt。portable 外壳可能是 32 位 NSIS，不能用外壳判断应用架构。

工作流配置需先推送到 GitHub 才可运行。没有在本次本地修改中触发远端构建或发布。

## 运行与验收

Electron 22 是最后支持 Win7 的系列，已停止安全维护。只保留屏幕/窗口接收，摄像头路径已移除。缺少运行库或系统更新的 SP1 安装仍可能无法启动，需要依据实际 DLL/系统错误处理。

Win7 会跳过现代内容保护 API；整屏采集可能包含接收端本身，应优先选择发送窗口。

本地可以验证 Electron 22/Chromium 108 的页面、压缩 API、WASM 解码与打包结果，但现代 Windows 上的运行不能代替 Win7 实机验证。目标环境需检查：

- 启动、黑白主题、窗口渲染。
- 窗口枚举、选择/取消/预览和屏幕采集。
- 文件、文本完整传输与 SHA-256 校验。
- 暂停/继续保持进度，终止清除进度并释放共享。
- 文件保存、保存目录；不同显示驱动/Aero/虚拟机配置。

尚未在真正的 Win7 SP1 系统上运行，不能声明已完成实机兼容认证。

## 本次验证（2026-11-03）

- 87 项单元测试通过；常规页面与独立 HTML 构建通过。
- 浏览器自动化：主题切换与保留、准备后显式开始、发送暂停/继续/终止、修改文本使旧准备失效、离开确认与接收终止确认、窄屏无横向溢出。
- 48 KB 随机文件通过真实二维码帧、WASM 解码、喷泉码恢复、SHA-256 校验并下载，与原始字节完全一致。此测试将发送端 canvas 帧注入模拟屏幕流，用于验证传输与交互，不代替系统窗口采集验收。
- 在当前 Windows 11 主机上运行打包后的 Electron 22.3.27 / Chromium 108.0.5359.215，验证页面加载、gzip 压缩/解压与实际 WASM 二维码解码。
- 构建脚本检查真正应用的 x64 PE 头与实际 Electron 版本，生成 `SHA256SUMS-win7.txt`。
