# 小羊图片工坊 0.2 · 照片库与 RAW

本地 Windows 工具，入口仍为工作箱中的小羊图片工坊。默认进入照片库，原来的批量转换保留在“格式转换”页签。统一登录、主题和窗口规格不变。

## 使用流程

1. 添加、拖入照片，或添加一个文件夹的直属照片（不递归子目录）。Windows exe 登记原文件位置，不搬动、复制或修改原片；同一路径重复导入不重复建档。
2. 搜索文件名、相机、镜头、标签；筛选 RAW、精选、拒绝、三星以上。数字 0–5 评级，P 精选，X 拒绝，U 取消标记，上下键切换照片。
3. 先显示相机内嵌预览，再显示真实 RAW 解码预览；信息页显示相机、镜头、ISO、快门、光圈、焦距与拍摄时间，缺失信息显示“—”。
4. 调整曝光、对比度、高光、阴影、饱和度、冷暖和色调。RAW 额外提供拍摄时／日光白平衡及基础降噪。支持 RGB 预览直方图、未调整对比、90°旋转、水平翻转、固定比例裁切与位置调节。
5. 保存调整或 Ctrl+S。切图、切页签、注销和正常关闭前保存待提交调整。Ctrl+Z／Ctrl+Y 撤销重做当前编辑；复制／粘贴调整，可应用到多选照片。
6. 导出当前或多选照片：JPG、PNG、WebP、16 位 TIFF，原始尺寸或长边 2048／3840 px。通过原生选择器选输出目录，同名自动编号；任务可停止。导出编辑参数得到 `.xiaoyang.json` 备份，此格式不等同 Adobe／Sony XMP，当前不提供 JSON 配方导入。

“移出库”只移除记录与缩略图，不删除引用原片。原片移动、丢失或内容改变会提示重新导入；重新导入已改变文件会更新预览并重置旧调整。参数、评级、标签按账号存入 SQLite，通过修订号防止旧请求覆盖新记录。

## 格式与限制

| 范围 | 支持 |
| --- | --- |
| 照片库输入 | ARW、DNG、JPG/JPEG、PNG、WebP、AVIF、TIF/TIFF |
| RAW | 单张不超过 256 MiB、6000 万像素 |
| 普通图片 | 单张不超过 256 MiB、4000 万像素；静态单页 |
| 队列与目录 | 原生单次导入／导出最多 500 张，每账号最多 5000 张 |
| RAW 信息 | 型号、镜头、ISO、快门、光圈、焦距、拍摄时间 |
| 普通图信息 | 当前读取尺寸与格式，未实现完整 EXIF 浏览 |

浏览器开发预览采用内容上传，保存托管副本；Windows exe 的系统选择器／原生拖入引用原路径。开发浏览器一次处理最多 100 张，正式原生入口最多 500 张。

## 解码与颜色

固定使用 **LibRaw 0.22.2** Windows x64 动态库与小型 .NET Framework 4.8 适配器。解码为线性 16 位 RGB，工作线程应用曝光／色调并编码为 sRGB。导出烘焙方向和裁切，携带 sRGB ICC，移除 EXIF/GPS；拍摄信息仍在原片和库记录中。

冷暖／色调是相对调整，不是精确开尔文值。高光／阴影为全局色调控制，无法恢复已剪切信息。基础降噪不是 AI 降噪。放大的是最长 1500 px 编辑预览，不是原生像素 1:1 检查。

相机 JPEG 的创意外观、DRO、镜头校正和 Sony 专有处理不会被此引擎复刻，因此默认 RAW 显示可能与内嵌 JPEG 不同。“原片对比”显示同一解码器的未调整结果。

尚未提供局部蒙版、镜头配置文件校正、透视、HDR、联机拍摄、AI 降噪、XMP 双向兼容或自定义相机色彩配置。后续扩展基于 `shared/photos.ts` 的版本化参数，不能静默改变已有照片的渲染语义。

## 本地数据与清理

- `photo-library/<账号>/<照片>/thumb.jpg` 是持久缩略图，关闭不会删除库、参数和缩略图。开发浏览器上传副本位于该账号的 `imports`；移出库时仅删除托管副本，不删除原路径引用。
- `photo-work-进程号/<账号>` 保存临时解码／编码文件。基础图按源路径、大小、修改时间、白平衡、冷暖、色调、降噪组合复用，保留的 TIFF 总量上限 420 MiB，任务处理中可能短暂超过。
- “清理解码缓存”、注销、正常关闭会清理临时文件；异常退出后，下次启动回收已终止进程专用目录。成功导出文件不当缓存清理。
- 逐张处理，RAW 原生线程限制为 2，单次解码上限 90 秒。预览更替会取消旧请求；RAW 子进程监测父进程。曝光等调整复用基础图，白平衡／降噪需重新解码。
- API 使用 no-store，全部本机处理，不上传照片。路径入口要求桌面令牌、登录会话及仅原生持有的文件能力令牌；页面只能传已导入 ID 和校验后的参数。拖入路径来自 WebView2 的 OS-backed File 对象，不接受网页 JSON 路径。

## 调研与选型

- [Sony Imaging Edge](https://imagingedge.sony.net/en-us/ie-desktop.html) 的 Viewer 提供浏览、比较、评级，Edit 提供 RAW 显影、亮度和白平衡。首版采用“导入—筛选—调整—导出”，联机拍摄暂不纳入。
- A7C II 的型号是 ILCE-7CM2；其 ARW 压缩和尺寸方式需要解码库明确支持：[Sony 规格](https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7cm2/specifications)、[RAW 文件类型](https://helpguide.sony.net/ilc/2360/v1/en/contents/0404I_raw_file_type.html)。
- [LibRaw 支持列表](https://www.libraw.org/supported-cameras) 明确包含 ILCE-7CM2；[0.22 版本](https://www.libraw.org/download) 新增 Sony M/S 无损 YCC RAW 支持。选用 0.22.2，保留统一 UI，解码 DLL 约 1.2 MB，不捆绑完整 RAW 编辑器。许可证和匹配源码随包提供。
- 参数与原片分离参照 [darktable 非破坏性编辑](https://docs.darktable.org/usermanual/5.6/en/overview/sidecar-files/sidecar/)，实际存储采用 SQLite 与自有 JSON，不声明编辑配方兼容。
- 使用 [raw.pixls.us](https://raw.pixls.us/) CC0 A7C II 压缩样本，以及用户授权只读的 5 张 ARW／5 张增强 DNG 验证；用户照片不随软件发布，测试派生图仅留在工程 runtime。

## 构建与验证

`npm run build`、`npm run images:host`、`node scripts/update-app.mjs` 更新开发版。更新脚本备份共享资源并构建 RAW 适配器；完整 `npm run desktop:build` 也包含该组件。需事先准备官方 LibRaw 0.22.2 Win64 包于 vendor；开发构建不在线下载依赖。

`npm test` 覆盖鉴权、原片保护、参数修订、裁切／旋转／缩放、16 位导出、持久化、缓存和取消；`npx tsx tests/photos-ui.ts` 检查真实 RAW 界面流程；`npx tsx tests/raw-compatibility.ts "样本目录"` 只读验证 ARW／DNG，派生结果在工程 runtime。实际完成范围见 [验证记录](VERIFICATION.md)。
