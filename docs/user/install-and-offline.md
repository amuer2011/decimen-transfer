# 安装与离线使用

桌面版自带页面、二维码生成器、WASM 解码器和 Electron 运行时，不需要安装 Node.js 或联网传输。Windows portable EXE 双击运行；Win7 使用单独的 `win7-x64.exe`。

网页版在首次加载和缓存完成后可以离线使用。屏幕采集要求浏览器支持 `getDisplayMedia`，并通过 HTTPS 或 localhost 打开。安装 PWA 不会给不支持采集的浏览器增加屏幕采集能力。

`npm run build:standalone` 生成独立发送和接收 HTML，内含代码与解码器。离线 HTML 的屏幕采集可用性仍取决于浏览器对本地文件、安全上下文和权限的限制，桌面场景建议使用桌面版。

主题选择：桌面版保存在当前用户配置目录，跨应用启动保留；网页/独立 HTML 在允许本地存储时保留选择。
