# Little Sheep ToolBox · 小羊工具箱

面向 Windows 的本地工具平台，统一应用入口、运行管理、登录、深浅色外观与截图管理。

主程序文件名为 `小羊工作箱.exe`。使用 WinForms + 系统 WebView2，界面和本机服务随程序运行。正常使用无需打开浏览器或单独启动 Node。当前为开发版，没有安装包、自动更新或云端账号。

## 功能

| 应用／平台能力 | 内容 |
| --- | --- |
| 应用管理 | 搜索、收藏、最近使用；实际运行状态；开始按钮运行时显示「运行中」，悬停显示「结束运行」 |
| 小羊网络测试 | 先下载 15 秒，再上传 15 秒；双栏速度曲线和峰值；国内节点切换、Ping、DNS、TCP、路由追踪、网络信息 |
| 小羊房间设计 | 二维自由画布、连续画线、Tab 精确长度、点与角度吸附、家具拖放、自定义尺寸模块与方案保存 |
| 小羊图片工坊 | 批量格式转换、Sony ARW／DNG 管理、非破坏性调整、裁切旋转、16 位 TIFF 导出与本地 OCR |
| 小羊电脑信息 | CPU 逻辑处理器、内存、GPU、磁盘和网卡；曲线、传感器、功率估算、快捷键悬浮窗 |
| 小羊视频播放器 | VLC 本地／网络播放，Emby／Jellyfin 媒体库、搜索、续播、HLS、字幕和截帧入库 |
| ShareX 截图中心 | 截图、编辑、复制、改名、打开目录、分类、收藏和回收站；自定义全局快捷键 |
| 外部应用 | 可登记黄狗风云、小羊象棋等 EXE；这些独立项目的源码及程序不包含在本仓库 |

独立工具窗口默认 1200×860、最小 1120×720。共用蓝色主色、紧凑控件和浅色／深色／跟随系统外观。登录页与工具内容分离。

## 开发

环境：Windows 10/11 x64、Node.js 22.17.x、.NET Framework 4.8、WebView2 Runtime。构建 ShareX 适配器另需 .NET 9 SDK。

```powershell
git clone https://github.com/AxeroYF/Little-Sheep-ToolBox.git
cd Little-Sheep-ToolBox
npm ci
npm run typecheck
npm test
npm run build
```

`npm run dev` 仅用于内部界面预览，交付入口是 EXE。Playwright 界面测试另需 `npx playwright install chromium`；原生集成测试还需准备对应组件及样本。

## 构建 Windows 客户端

第三方二进制、源码归档、照片样本与构建产物不提交 Git，需先准备：

1. WebView2 NuGet SDK `1.0.4022.49`：默认读取本机 NuGet 缓存，或将 `WORKBOX_WEBVIEW2_SDK` 指向解压目录。
2. `powershell -File scripts/prepare-sharex.ps1`：下载校验 ShareX 组件与源码。
3. `powershell -File scripts/prepare-integrations.ps1`：准备 LibreHardwareMonitor 与 Tesseract OCR。
4. LibRaw 官方 `0.22.2 Win64` 包保存到 `vendor/LibRaw-0.22.2-Win64.zip`，解压为 `vendor/LibRaw-0.22.2/LibRaw-0.22.2`，使其中 `bin/libraw.dll` 可用。来源和校验值见 [第三方说明](docs/THIRD-PARTY.md)。
5. `powershell -File scripts/prepare-video.ps1`：准备固定版本 LibVLC x64 组件与源码。

```powershell
npm run desktop:build
npm start
```

输出为 `desktop-dev/小羊工作箱.exe` 及同目录的内置工具。移动程序时保留整个 `desktop-dev` 目录。已有开发目录可先 `npm run build`，再 `node scripts/update-app.mjs` 增量更新；从托盘退出并重开工作箱后加载更新。

## 本机配置和数据

公开的 `config/apps.json` 初始为空。外部应用写入不提交 Git 的 `config/apps.local.json`，存在时优先使用；参考 [配置示例](config/apps.example.json)。构建会将本机配置复制到开发目录，源码中不包含个人 EXE 路径。

首次创建的公开开发账号为「小羊」，开发密码为 `Workbox-Local-Dev-2026!`。可通过环境变量 `WORKBOX_INITIAL_PASSWORD` 指定首次创建密码（8–128 字符），或使用本机 `config/account.local.json` 中的 `salt` 与 `passwordHash`。本机配置只保存 scrypt 哈希；已有数据库账号不会因更新或初始化配置变化被重置。原开发环境的私人初始化配置已单独保留，不纳入 Git。

用户数据默认保存在 `%LOCALAPPDATA%/XiaoyangWorkbox`。账号、截图、照片库、房间方案、播放记录与服务器令牌不属于仓库内容。播放器令牌使用 Windows DPAPI 加密；照片原片只读；截图默认关闭上传。备份前退出所有使用该数据目录的工具。

## 目录与文档

- `src/`：React 界面；`shared/`：共享类型与规则；`server/`：本机服务。
- `desktop/`：WinForms 宿主、硬件／RAW／VLC／ShareX 适配器。
- `scripts/`：组件准备、构建与更新；`tests/`：单元和集成测试。
- [统一接入规范](docs/STANDARDS.md)、[应用运行管理](docs/APP-LIFECYCLE.md)、[第三方来源和许可](docs/THIRD-PARTY.md)、[验证记录](docs/VERIFICATION.md)。
- [网络测试](docs/NETWORK-TEST.md)、[房间设计](docs/ROOM-DESIGN.md)、[图片工坊](docs/IMAGE-WORKSHOP.md)、[RAW 工作流](docs/PHOTO-WORKFLOW.md)、[OCR](docs/OCR.md)、[电脑信息](docs/COMPUTER-INFO.md)、[视频播放器](docs/VIDEO-PLAYER.md)。

Git 只管理项目源码、配置示例与文档。依赖目录、程序包、运行数据、个人配置、截图素材和密钥文件均排除；第三方组件沿用各自许可，详见第三方说明。
