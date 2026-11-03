# Decimen Optical Transfer

通过动态二维码传输文件和文本，从屏幕或窗口接收。适用于远程桌面、虚拟机等场景，传输不依赖设备间的网络连接。

## 使用

1. 在发送端选择文件（最大 64 MB）或准备文本（最大 4 MB），点击“开始传输”。
2. 在接收端点击“选择接收窗口”，选择含二维码的远程桌面或虚拟机窗口。
3. 接收完成并通过 SHA-256 校验后，保存文件或复制文本。
4. 在发送端手动终止。光学传输没有回传通道，发送端不能自动得知接收完成。

摄像头功能已移除，仅支持屏幕/窗口接收。请保持发送窗口可见且持续更新，不要最小化。

- 发送：选择内容 → 准备就绪 → 开始 → 暂停 / 继续 → 终止。
- 接收：选择窗口 → 收集与恢复 → 暂停 / 继续 → 校验 → 保存。
- 暂停保留同一会话与接收进度；终止接收会释放共享、解码线程并清除进度。
- 传输中不能更换内容或编码设置，避免无意重置接收进度。退出页面前会提示确认。
- 黑色、白色主题均可手动选择。桌面版记住选择，窗口选择器跟随主题。
- 内容未加密，所有能读取发送画面的接收方都能获取内容。

## 构建

构建机使用现代 Windows/macOS/Linux 与 Node.js 22 或更新版本。最终用户无需 Node.js。

```sh
npm ci
npm test
npm run build
npm run build:standalone
```

```sh
npm run desktop:win      # 常规 Windows x64，Electron 40
npm run desktop:win7     # Win7 SP1 x64，Electron 22.3.27，独立构建
npm run desktop:mac      # macOS Intel + Apple Silicon
npm run desktop:kylin    # Kylin Linux arm64
```

常规桌面产物在 `artifacts/desktop/`。Win7 产物为：

```text
artifacts/desktop/win7/Decimen.Optical.Transfer-v<version>-win7-x64.exe
```

Win7 工作流为 **Win7 Desktop**（`.github/workflows/win7-desktop.yml`），可单独手动构建；推送 `v*` tag 时构建并附加到 Release。手动运行不填写 `release_tag` 仅生成工作流下载产物。首次使用该工作流，需要先将代码推送到 GitHub。

Win7 目标为 **6.1.7601 SP1 x64**。Electron 22 已停止维护；目标系统的启动、显卡和窗口采集能力仍需实机验收。[Win7 构建与验证说明](docs/technical/windows7.md)。

网页版用 `npm run dev` 启动 HTTPS 开发服务，或通过 HTTPS / localhost 部署 `dist/`。桌面版自动在 `127.0.0.1` 提供打包页面，不需要互联网。

## 文档

- [快速开始](docs/user/quick-start.md)
- [发送](docs/user/sending.md) · [接收](docs/user/receiving.md)
- [故障排查](docs/user/troubleshooting.md) · [离线使用](docs/user/install-and-offline.md)
- [隐私](docs/user/privacy.md)
- [协议](docs/technical/protocol.md) · [构建与发布](docs/technical/build-and-release.md)

## License

MIT. Original project by [Evan Crawley (Bash Alarmist)](https://www.linkedin.com/in/evan-crawley), using [node-qrcode](https://github.com/soldair/node-qrcode) and [zxing-wasm](https://github.com/Sec-ant/zxing-wasm).
