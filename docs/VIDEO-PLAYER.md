# 小羊视频播放器 0.1

Windows x64 本地客户端，入口 `desktop-dev/小羊视频播放器.exe`。工作箱自动登记为 `xiaoyang-video`，沿用单实例、主题、独立登录边界以及「开始／运行中／结束运行」按钮；窗口默认 1200×860、最小 1120×720。仅提供开发目录，尚未制作安装程序。

## 使用

- **打开视频**：选择或拖入本地视频，首项自动播放；MP4、MKV、MOV、AVI、TS、WebM 等由 VLC 解码，具体支持取决于媒体编码及上游组件。播放列表最多 200 项，移除只清记录，不删除原文件。
- **播放链接**：HTTP、HTTPS、RTSP、HLS；M3U 可作为列表导入，HLS 清单直接交给解码器。可填写 User-Agent、Referer 和缓冲时间。带账号密码的 URL 不接受，影视服务器通过专门登录入口连接。
- **连接服务器**：选择 Emby 或 Jellyfin，填写地址、用户名、密码。支持局域网 IP、自定义端口、HTTPS 和反向代理路径；例如 `https://example.com/jellyfin`。可浏览媒体库、剧集／季、搜索和分页。原画直连优先，遇到编码／网络问题可切换「兼容转码 · HLS」后重新打开；转码需要服务器允许且具备相应资源。
- 播放控制包括暂停、进度跳转、0.5–4 倍速、音量、音轨、字幕轨、外置字幕、字幕延迟、画面比例、置顶和全屏。非输入控件获得焦点时，空格暂停、左右键跳转 10 秒、F 全屏；Esc 退出全屏。
- 当前画面保存至工作箱的截图管理，可使用已有的改名、复制、打开文件夹等操作。
- 本地／链接记录保存播放位置。服务器视频读取服务端位置，每 10 秒及暂停时上报进度，停止／关闭时尝试发送停止事件。接口失败显示提示，不伪造同步成功。非可定位直播不提供进度跳转。

## 实现与数据

`VideoCore.cs` 通过稳定 C ABI 动态调用官方 LibVLC 3.0.24。视频渲染到 WinForms HWND，媒体不会经网页或 Node 转发，也不把每帧复制进 JS。默认请求硬件解码，能否启用由 VLC、驱动和媒体决定。打开视频时才加载核心，停止和释放在后台执行，退出等待资源释放。

`VideoNative.cs` 提供受会话保护的有限操作，网页不能提交任意本机路径或 VLC 参数。原生选择器／WebView2 的 OS-backed File 授权本地导入。网页报告视频区域大小，宿主按 DPI 比例定位 HWND；显示网页弹窗时暂时隐藏视频表面，避免覆盖输入框。

`VideoServers.cs` 处理认证、浏览、播放信息和进度接口。API 使用认证头，限制响应大小、超时及认证重定向来源。原画／HLS 播放地址按服务器接口使用 `api_key`，只给同源地址附加令牌；令牌不传给网页。此版本没有实现 Jellyfin 禁用旧式 URL 令牌后的流媒体头转发适配，没有绕过 TLS 证书校验。

`数据目录/video/<工作箱账号 ID>.dat` 使用 Windows 当前用户 DPAPI 加密，存放服务器令牌、播放列表与续播位置。密码只用于当次登录请求，不保存；不能将此文件直接当成跨电脑备份。损坏或解密失败保留原文件并报错，不覆盖历史。断开服务器移除本机令牌与该服务器列表项，并尝试注销远端令牌。

播放缓冲位于内存，不自动下载整部影片。`video/frames/<UUID>.png` 仅用于截帧交接，成功或失败后清理；异常退出遗留在下次启动清理。已进入截图管理的图片属于持久内容。WebView2 自身缓存沿用工作箱规则。

## 构建和验证

先运行 `powershell -File scripts/prepare-video.ps1` 获取并校验固定官方包，再 `npm run build` 与 `node scripts/update-app.mjs` 更新开发目录。`node scripts/build-managed-hosts.mjs` 可单独重新编译原生入口。VLC x64 DLL／插件约 104 MiB，独立目录动态加载，没有打包完整 VLC 界面、x86／ARM 运行库或额外 Chromium。

- `node tests/native-video.mjs`：生成本地 AVI 与 HLS 测试片，实际 LibVLC 解码、尺寸、暂停、跳转、倍速、字幕、音轨、音量、截帧、HTTP Range；本机模拟 Emby／Jellyfin 的登录、目录、续播、转码协商、鉴权和进度接口；加密数据读写及输入校验。
- `npx tsx tests/video-ui.ts`：实际 UI 配合确定性原生桥接桩，检查登录隔离、深浅色、最小尺寸、弹窗隐藏视频、全屏退出、服务器目录与操作参数。此项不替代原生解码测试。
- `npx tsx --test tests/screenshots.test.ts`：截帧接口鉴权、原生能力令牌、无效图片拒绝、原图完整性和图库接入。
- `node tests/video-host.mjs`：常规 Windows 桌面环境运行隔离账号数据的真实 WinForms／WebView2／LibVLC 集成测试，验证原生消息、视频矩形、弹窗遮挡、截图入库、暂停、全屏及注销释放。需要先构建开发目录并生成 native-video 夹具；受限沙箱可能阻止 WebView2 初始化。

用户真实服务器地址、账号及内容尚未提供，因此无法声称已在用户服务器完成实测。首版未实现海报缓存、下载／离线缓存、电视遥控界面、多版本媒体选择、外置服务器字幕列表和 DRM 播放。

参考：[LibVLC 官方资料](https://www.videolan.org/vlc/libvlc.html)、[官方 Windows 组件](https://www.nuget.org/packages/VideoLAN.LibVLC.Windows/3.0.24)、[Emby 用户认证](https://dev.emby.media/doc/restapi/User-Authentication.html)、[Emby 播放进度接口](https://dev.emby.media/doc/restapi/Playback-Check-ins.html)、[Jellyfin 网络配置](https://jellyfin.org/docs/general/post-install/networking/)。
