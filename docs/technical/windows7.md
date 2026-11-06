# Windows 7 SP1 x64

目标系统：Windows 7 6.1.7601 Service Pack 1，64 位。常规 Windows 包使用 Electron 40；本通道固定 Electron 22.3.27 / Chromium 108，前端构建目标为 chrome108。

## 构建

在现代 Windows 和 Node.js 22+ 上运行：

```powershell
npm ci
npm test
npm run desktop:win7            # 便携版
npm run desktop:win7:installer  # 安装版
npm run desktop:win7:all        # 同时生成两种格式
```

产物在 `artifacts/desktop/win7/Decimen.Optical.Transfer-v<version>-win7-x64.exe`。用户无需 Node.js。配置为 `desktop/electron-builder.win7.yml`，继承路径相对项目根目录。Win7 使用独立名称、appId 与输出目录，避免与常规版本的用户配置混淆。

安装版文件名为 `Decimen.Optical.Transfer-v<version>-win7-x64-Setup.exe`，与便携版位于同一目录。安装时可选择目录，默认当前用户安装。文本专用版命令对应为 `desktop:text:win7`、`desktop:text:win7:installer`、`desktop:text:win7:all`，产物位于 `artifacts/desktop/text/win7/`，文件名增加 `.Text`，使用独立 appId。

## GitHub Actions

官方发布由统一工作流 **Release**（`.github/workflows/release.yml`）负责：推送 `v*` tag 后，桌面矩阵同时构建完整版/文本版的 Windows 10+、Win7、macOS x64/arm64 与麒麟 arm64；全部任务成功后统一校验并发布。Win7 的矩阵项为 `win7-full` 与 `win7-text`，分别调用 `desktop:win7:all` 和 `desktop:text:win7:all`，同时生成便携版与安装版。

独立工作流 **Win7 Desktop**（`.github/workflows/win7-desktop.yml`）现在仅支持手动运行，不再响应 `v*` tag：

- 手动运行：可指定 ref，留空则使用所选分支/tag；默认仅上传构建 artifact。
- 手动填写 `release_tag`：将构建产物附加到该 Release。
- 官方 tag 发布不要使用该工作流，统一走 **Release**。

构建 job 只有读取权限；发布 job 单独授予写入权限。工作流调用 `desktop:win7:all`，同时生成便携版与安装版。发布前检查两种 EXE、真正应用 EXE 的 x64 PE 头、app.asar 和应用实际报告的 Electron 版本，并生成覆盖两种产物的 `SHA256SUMS-win7.txt`。仅构建安装版时生成 `SHA256SUMS-win7-setup.txt`；文本版清单对应增加 `text-` 前缀。portable 外壳可能是 32 位 NSIS，不能用外壳判断应用架构。

工作流配置需先推送到 GitHub 才可运行；正式发布请推送与 package.json 版本一致的 tag。

## 更新

Win7 桌面版固定 Electron 22.3.27，更新通道为 `win7`（完整版）和 `text-win7`（文本专用版），与 Windows 10+ 的 `latest`/`text` 分开；版本、版本类型、平台架构或通道不匹配时拒绝更新，避免串包。安装版在下载校验后可重启并安装；便携版只下载对应便携 EXE 并打开所在目录，由用户手动替换。

传输进行中或有未保存的接收结果时会拒绝重启，并保留已下载的更新；关闭“关于”对话框不会中断下载。应用默认不联网，只有主动点击“检查更新”才访问 GitHub。

更新库 `electron-updater` 6.8.11 仍需在当前 Win7 目标主机上做兼容验证；现有构建与测试不能替代实机兼容认证。首次从旧版本使用应用内更新，需要先手动安装 v1.0.8。

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
