# ShareX

小羊工作箱使用未经修改的 ShareX 21.0.0 Windows x64 便携组件；专用适配进程加载其程序集，调用该固定版本的截图和编辑功能。
ShareX 是 ShareX Team 的独立开源软件；工作箱的登录、图库和元数据管理由工作箱提供。

- 项目：https://getsharex.com/
- 发布：https://github.com/ShareX/ShareX/releases/tag/v21.0.0
- 对应源码：https://github.com/ShareX/ShareX/tree/v21.0.0
- 许可证：随开发目录提供 `ShareX-LICENSE.txt`，原始组件另含 `Licenses` 目录。
- 对应版本源码压缩包：随开发目录提供 `ShareX-21.0.0-source.zip`。

`ShareX.Workbox` 适配器通过反射动态加载 ShareX，使用匿名标准输入／输出管道接收固定截图命令，使用本地任务文件回传结果。适配器源码位于 `desktop/sharex-host`，以 GPL-3.0-or-later 提供；交付副本为 `third-party/sharex-workbox-source`，许可证为同目录上一级的 `ShareX-LICENSE.txt`。构建适配器需 .NET 9 SDK：`dotnet build ShareX.Workbox.csproj -c Release`；将输出 exe、dll 和上游便携包放在同一目录，并以 `ShareX.Workbox` 名称复制上游 runtimeconfig/deps 文件。完整构建步骤由工作箱 `scripts/build-desktop.mjs` 执行。

保留上游许可证、第三方依赖声明、对应源码和适配器源码；后续制作安装包时应一并携带。适配器固定兼容 ShareX 21.0.0，升级上游必须重新验证内部调用、输出回执和退出流程。

组件放置于工作箱数据目录的 `components/sharex-21.0.0`，登录后后台预热并复用，退出登录或退出工作箱时关闭；未登录时不启动。独立配置关闭上传、更新检查和 ShareX 快捷键，工作箱负责全局快捷键。不获取上游全局单例互斥锁，不修改用户另行安装的 ShareX 及其配置。同卷原始组件文件使用硬链接节省空间，跨卷复制；组件初次准备和驻留会增加磁盘与内存占用。发布版不在线下载安装组件。

官方便携包 SHA-256：
`8124938fa718d702bb08ef29292f0140052bdad03d23b3041b5015054ff1c230`

# 图片工坊：sharp / libvips

使用 npm 固定版本 `sharp 0.35.5` 与其官方 Windows x64 预构建组件 `@img/sharp-win32-x64 0.35.5`，当前包含 libvips 8.18.7。引擎在第一次处理图片时加载，不连接云端。

- sharp 项目及源码：[lovell/sharp v0.35.5](https://github.com/lovell/sharp/tree/v0.35.5)，Apache-2.0。
- 原生依赖的构建来源：[sharp-libvips](https://github.com/lovell/sharp-libvips)；libvips：[8.18.7 对应源码](https://github.com/libvips/libvips/tree/v8.18.7)。
- 原生包同时包含 LGPL 组件。保留动态 DLL，可替换同 ABI 的兼容库；不将其静态链接进工具箱 exe。
- 交付目录 `app/node_modules/sharp`、`app/node_modules/@img/sharp-win32-x64` 保留上游 LICENSE、README 和版本清单；README 列明各编解码依赖及其许可，`versions.json` 记录实际版本。
- `scripts/image-runtime.mjs` 递归复制当前 Windows x64 所需依赖及其原始许可文件。后续对外发行安装包时，应按各库许可附带对应源码／源码获取材料及完整声明。

# RAW 照片库：LibRaw

- 使用官方未经修改的 LibRaw **0.22.2 Win64** 动态库：[项目](https://www.libraw.org/)、[官方包及源码](https://www.libraw.org/download)、[v0.22.2 源码](https://github.com/LibRaw/LibRaw/tree/0.22.2)。
- 上游提供 LGPL-2.1 / CDDL-1.0 双许可，交付目录保留 `LICENSE.LGPL`、`LICENSE.CDDL` 与 `COPYRIGHT`，本适配按 LGPL 动态链接方式提供可替换 DLL。原始 ZIP 中的源码、构建说明和许可证随 `third-party/LibRaw-0.22.2-Win64-with-source.zip` 提供。
- `desktop/RawPhoto.cs` 为工作箱自有进程适配器，通过固定 0.22.2 C ABI 与 Unicode 只读 API 解码；源码也放入组件目录。重新构建：`node scripts/build-raw-host.mjs`，需要系统 .NET Framework 4.x C# 编译器，匹配 ABI 的动态库可替换，升级上游需重新校验结构布局及兼容样本。
- `components/LibRaw-0.22.2/RawPhoto.exe` 只在 RAW 识别／显影期间运行，不提供外网通信，不改动输入文件。照片库 UI、评级和编辑参数由工作箱实现，LibRaw 不提供 Sony 专有成像风格。
- 公共测试样本来自 raw.pixls.us 的 CC0 A7C II 压缩样本（记录 6868）；测试资产与用户样本均不打包到应用。

LibRaw 官方 Win64 包 SHA-256：`ac64fa12bb00a7581332d4c6ab918c0533fb3f119d6b668d47a6875410dca948`。

# LibreHardwareMonitor

使用未经修改的 [LibreHardwareMonitor 0.9.6](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6) .NET Framework 库，MPL-2.0；交付 `components/hardware` 的 DLL 保持动态可替换，适配源码 `HardwareTelemetry.cs` 随组件提供。官方对应版本源码与 LICENSE 在 `third-party/LibreHardwareMonitor-0.9.6`。上游源码 LICENSE 同时列出依赖及附加许可。没有运行上游 GUI、PawnIO 安装程序或修改硬件控制值。

官方 `LibreHardwareMonitor.zip` SHA-256：`086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001`。

# Tesseract OCR

使用官方 [Tesseract 5.5.3 Windows 发布](https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.3)的未经修改 CLI 与依赖 DLL；解压后按 PE 导入闭包裁剪，未安装到系统。Tesseract 和 [tessdata_fast 固定提交](https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd)为 Apache-2.0，包含 eng／chi_sim／osd 模型。Leptonica 1.87.0 使用 BSD 风格许可，相关许可保存在 `third-party/Tesseract-5.5.3`。其他动态依赖沿用官方 Windows 包（含图像编解码、压缩、curl、MinGW 运行时），不作修改；对外发布安装包前需完整归集其各自许可和相应源码材料。当前仍为本地开发交付。

官方安装包 SHA-256：`bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`。三个模型及实际复制二进制清单在 `components/Tesseract-5.5.3/version.json`。

# LibVLC 视频内核

使用官方 NuGet [VideoLAN.LibVLC.Windows 3.0.24](https://www.nuget.org/packages/VideoLAN.LibVLC.Windows/3.0.24) 的 LGPL 包（非 `.GPL` 包），保留未经修改的 x64 `libvlc.dll`、`libvlccore.dll`、解码／输出插件及 HRTF 文件。没有打包 VLC 桌面界面，也未使用 LibVLCSharp 程序集。自有适配器动态调用 C ABI，可替换相同 ABI 的库；第三方库不静态链接进工作箱 exe。

包 SHA-256：`3da3f37ee2b2b10e5c788d830a3b513658c36521ea1b0f966ed86eb69f41ef3c`。对应上游 [VLC 3.0.24 源码](https://download.videolan.org/pub/videolan/vlc/3.0.24/vlc-3.0.24.tar.xz) SHA-256：`e7cab503d1d7d5849b89d2cf0e1ee60d0ef6d012407791b644b9cfc0cc225fdf`。

`third-party/LibVLC-3.0.24` 保存源码归档、COPYING、COPYING.LIB、原包 nuspec 和自有适配源码；`components/LibVLC-3.0.24/version.json` 列出实际 DLL／插件、大小和校验值。LibVLC 采用 LGPL-2.1-or-later，VLC 源码中不同模块及 contrib 依赖各有许可，不应将其全部简化为同一许可证。源码归档含 contrib 构建配方；当前本地开发交付不等同于完成对外安装包发行材料。对外分发前需针对实际二进制完整归集对应依赖源码、许可和重新链接材料。
