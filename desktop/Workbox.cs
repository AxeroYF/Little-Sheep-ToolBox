using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Linq;
using System.IO.Compression;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [STAThread] static void Main(string[] args) {
        bool network = Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("网络") || Array.IndexOf(args, "--network") >= 0;
        bool room = Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("房间") || Array.IndexOf(args, "--room") >= 0;
        bool images = Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("图片") || Array.IndexOf(args, "--images") >= 0;
        bool computer = Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("电脑信息") || Array.IndexOf(args, "--computer") >= 0;
        bool video = Path.GetFileNameWithoutExtension(Application.ExecutablePath).Contains("视频") || Array.IndexOf(args, "--video") >= 0;
        string title = video ? "小羊视频播放器" : computer ? "小羊电脑信息" : images ? "小羊图片工坊" : room ? "小羊房间设计" : network ? "小羊网络测试" : "小羊工作箱";
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XiaoyangWorkbox");
        foreach (string arg in args) if (arg.StartsWith("--data-dir=")) data = Path.GetFullPath(arg.Substring(11));
        bool first;
        using (var mutex = new Mutex(true, "Local\\XiaoyangWorkbox-" + (video ? "Video" : computer ? "Computer" : images ? "Images" : room ? "Room" : network ? "Network" : "Home") + "-" + Environment.UserName, out first)) {
            if (!first) { var h = FindWindow(null, title); if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); } return; }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WorkboxWindow(title, network, data, room, images, computer, video));
        }
    }
}
internal partial class WorkboxWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly Label status = new Label();
    readonly string dataDir; readonly bool network, room, images, computer, video;
    bool auxiliary { get { return network || room || images || computer || video; } }
    bool roomDirty, roomClosingApproved, roomClosePending;
    Process service; string origin; string token; string nativeFilesToken;
    readonly NotifyIcon tray = new NotifyIcon();
    bool closeToTray, signedIn, exiting, capturePending, recordingHotkey, savingHotkey, minimizeOnCapture=true;
    readonly CaptureHotkey hotkeys;
    string desiredHotkey=CaptureHotkey.Default;
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr window,string name,IntPtr value);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
    static readonly uint ManagedExit=RegisterWindowMessage("Xiaoyang.Workbox.Exit.v1"),ManagedShow=RegisterWindowMessage("Xiaoyang.Workbox.Show.v1");
    public WorkboxWindow(string title, bool isNetwork, string data, bool isRoom=false, bool isImages=false, bool isComputer=false, bool isVideo=false) {
        Text = title; network = isNetwork; room = isRoom; images = isImages; computer = isComputer; video=isVideo; dataDir = data;
        Size = new Size(1200, 860); MinimumSize = auxiliary ? new Size(1120, 720) : new Size(900, 660); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(245,246,248); AutoScaleMode = AutoScaleMode.Dpi;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        hotkeys=new CaptureHotkey(Handle);
        SetProp(Handle,"Xiaoyang.Workbox.ManagedExit.v1",new IntPtr(1));
        status.Text = "正在打开" + title + "…"; status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleCenter; status.Font = new Font("Microsoft YaHei UI", 12);
        Controls.Add(status); view.Dock = DockStyle.Fill;
        Shown += async delegate { await Open(); };
        if (!auxiliary) {
            tray.Icon = Icon; tray.Text = title;
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开工作箱",null,(s,e)=>Restore());
            menu.Items.Add("截图",null,async(s,e)=>await BeginCapture("region",null));
            menu.Items.Add("退出",null,(s,e)=>{ exiting=true; Close(); });
            tray.ContextMenuStrip=menu; tray.DoubleClick+=(s,e)=>Restore();
            tray.BalloonTipClicked+=(s,e)=>{ Restore(); Post(new { type="open-screenshots" }); };
        }
        if(computer) InitComputer();
        if(video) InitVideo();
        FormClosing += (s,e)=> {
            if(video&&!videoClosing){e.Cancel=true;CloseVideo();return;}
            if(computer && computerSettings.closeToTray && !exiting && e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();return;}
            if((room || images) && roomDirty && !roomClosingApproved && e.CloseReason==CloseReason.UserClosing) {e.Cancel=true;if(!roomClosePending){roomClosePending=true;Post(new {type=images?"image-close-request":"room-close-request"});}return;}
            if(!auxiliary && closeToTray && !exiting && e.CloseReason==CloseReason.UserClosing) { e.Cancel=true; tray.Visible=true; Hide(); }
        };
        Deactivate += delegate { if(recordingHotkey && !savingHotkey) {recordingHotkey=false;ApplyHotkey();Post(new {type="hotkey-recording-cancelled"});} };
        FormClosed += delegate { DisposeVideo(); DisposeComputer(); hotkeys.Dispose(); tray.Dispose(); view.Dispose(); StopService(); };
    }
    void Restore() { Show(); WindowState=FormWindowState.Normal; Activate(); if(computer) ComputerVisibility(); }
    void Post(object message) { if(view.CoreWebView2!=null) view.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(message)); }
    protected override void WndProc(ref Message m) {
        if((uint)m.Msg==ManagedShow){Restore();return;}
        if((uint)m.Msg==ManagedExit){Restore();exiting=true;Close();return;}
        if(m.Msg==0x0312 && m.WParam.ToInt32()==hotkeys.ActiveId && signedIn && !recordingHotkey && !savingHotkey) { if(computer){if(!computerRecording&&!computerSaving)ToggleComputerOverlay();}else {var ignored=BeginCapture("region",null);} }
        base.WndProc(ref m);
    }
    async Task BeginCapture(string mode,string parent) {
        if(auxiliary || !signedIn || capturePending || !new[]{"region","window","screen","edit"}.Contains(mode)) return;
        Guid id; if(mode=="edit" && !Guid.TryParse(parent,out id)) return;
        capturePending=true;
        try {
            if(mode!="edit" && minimizeOnCapture) await CaptureWindowTransition.PrepareAsync(this);
            if(!signedIn || IsDisposed || Disposing) {capturePending=false;return;}
            Post(new {type="capture-request",mode=mode,parentId=parent});
        } catch(Exception) {
            capturePending=false;
            if(!IsDisposed && !Disposing) { Restore(); Post(new {type="native-error",message="窗口尚未准备好，请重新截图"}); }
        }
    }
    void StopService() { if (service != null) {
        try { if (!service.HasExited && origin != null) {
            var request = (HttpWebRequest)WebRequest.Create(origin + "/api/desktop/shutdown");
            request.Method = "POST"; request.ContentType = "application/json"; request.ContentLength = 2;
            request.Timeout = 800; request.ReadWriteTimeout = 800;
            request.Headers["Origin"] = origin; request.Headers["X-Workbox-Desktop"] = token;
            using(var stream = request.GetRequestStream()) { byte[] body = System.Text.Encoding.UTF8.GetBytes("{}"); stream.Write(body,0,body.Length); }
            using(var response = request.GetResponse()) { }
            service.WaitForExit(images ? 23000 : 1200);
        } } catch { }
        try { if (!service.HasExited) service.Kill(); } catch { }
        service.Dispose(); service = null;
    } }
    async Task Open() {
        try {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            Directory.CreateDirectory(dataDir);
            var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); int port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
            origin = "http://127.0.0.1:" + port; token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
            nativeFilesToken = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), "\"" + Path.Combine(root, "app", "server.cjs") + "\"");
            start.WorkingDirectory = Path.Combine(root, "app"); start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardError = true; start.RedirectStandardOutput = true;
            start.EnvironmentVariables["WORKBOX_PORT"] = port.ToString(); start.EnvironmentVariables["WORKBOX_HOST"] = "127.0.0.1";
            start.EnvironmentVariables["WORKBOX_ORIGIN"] = origin; start.EnvironmentVariables["WORKBOX_DESKTOP_TOKEN"] = token;
            start.EnvironmentVariables["WORKBOX_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString();
            start.EnvironmentVariables["WORKBOX_DATABASE"] = Path.Combine(dataDir, "workbox.sqlite");
            start.EnvironmentVariables["WORKBOX_NETWORK_EXE"] = Path.Combine(root, "小羊网络测试.exe");
            start.EnvironmentVariables["WORKBOX_ROOM_EXE"] = Path.Combine(root, "小羊房间设计.exe");
            start.EnvironmentVariables["WORKBOX_COMPUTER_EXE"] = Path.Combine(root,"小羊电脑信息.exe");
            start.EnvironmentVariables["WORKBOX_COMPUTER_PROBE"] = Path.Combine(root,"ComputerProbe.exe");
            start.EnvironmentVariables["WORKBOX_IMAGE_EXE"] = Path.Combine(root, "小羊图片工坊.exe");
            start.EnvironmentVariables["WORKBOX_NATIVE_FILES_TOKEN"] = nativeFilesToken;
            start.EnvironmentVariables["WORKBOX_RAW_EXE"] = Path.Combine(root,"components","LibRaw-0.22.2","RawPhoto.exe");
            start.EnvironmentVariables["WORKBOX_PROBE_EXE"] = Path.Combine(root, "NetworkProbe.exe");
            start.EnvironmentVariables["WORKBOX_DATA_DIR"] = dataDir;
            start.EnvironmentVariables["WORKBOX_SHAREX_SOURCE"] = Path.Combine(root,"components","ShareX-21.0.0");
            start.EnvironmentVariables["WORKBOX_CAPTURE_BRIDGE"] = Path.Combine(root,"CaptureBridge.exe");
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); start.EnvironmentVariables.Remove("NODE_OPTIONS");
            service = new Process(); service.StartInfo = start;
            service.ErrorDataReceived += (s,e) => { if (e.Data != null) { try { File.AppendAllText(Path.Combine(dataDir, "desktop-error.log"), e.Data + Environment.NewLine); } catch { } } };
            service.OutputDataReceived += (s,e) => { };
            service.Start(); service.BeginErrorReadLine(); service.BeginOutputReadLine();
            bool ready = false;
            for (int i=0;i<100;i++) {
                if (service.HasExited) throw new Exception("本地服务未能启动。请查看数据目录中的 desktop-error.log。");
                try { using (var client = new WebClient()) { client.Headers["X-Workbox-Desktop"] = token; string health = await client.DownloadStringTaskAsync(origin + "/api/health"); if (health.Contains("xiaoyang-workbox")) { ready = true; break; } } } catch { }
                await Task.Delay(100);
            }
            if (!ready) throw new Exception("本地服务启动超时。");
            Controls.Add(view); view.BringToFront();
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WorkboxWebView"));
            await view.EnsureCoreWebView2Async(env);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false; view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false; view.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            view.CoreWebView2.WebResourceRequested += (s,e) => {
                if (e.Request.Uri.StartsWith(origin + "/", StringComparison.Ordinal)) e.Request.Headers.SetHeader("X-Workbox-Desktop", token);
                else e.Response = env.CreateWebResourceResponse(new MemoryStream(), 403, "Blocked", "Content-Type: text/plain");
            };
            view.CoreWebView2.NavigationStarting += (s,e) => { if (!e.Uri.StartsWith(origin + "/", StringComparison.Ordinal)) e.Cancel = true; };
            view.CoreWebView2.NewWindowRequested += (s,e) => e.Handled = true;
            view.CoreWebView2.PermissionRequested += (s,e) => e.State = CoreWebView2PermissionState.Deny;
            view.CoreWebView2.WebMessageReceived += OnMessage;
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window,'workboxNative',{value:true,writable:false});");
            view.Source = new Uri(origin + (video ? "/?window=video" : computer ? "/?window=computer" : images ? "/?window=images" : room ? "/?window=room" : network ? "/?window=network" : "/")); status.Visible = false;
        } catch (Exception ex) { StopService(); view.Visible = false; status.Visible = true; status.BringToFront(); status.Text = "启动失败\n\n" + ex.Message + "\n\n需要 Windows WebView2 Runtime。此程序不会自动安装组件。"; }
    }
    async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if (!e.Source.StartsWith(origin + "/", StringComparison.Ordinal) || e.WebMessageAsJson.Length > 2000000) return;
        try {
            var serializer = new JavaScriptSerializer(); var message = serializer.DeserializeObject(e.WebMessageAsJson) as System.Collections.Generic.Dictionary<string,object>;
            if (message == null || !message.ContainsKey("action")) return;
            string action = message["action"] as string;
            if(room && action=="room-dirty") roomDirty=message.ContainsKey("dirty") && message["dirty"] is bool && (bool)message["dirty"];
            if(room && action=="room-close-ready") {roomClosingApproved=true;Close();return;}
            if(room && action=="room-close-cancel") roomClosePending=false;
            if(images && action=="image-dirty") roomDirty=message.ContainsKey("dirty") && message["dirty"] is bool && (bool)message["dirty"];
            if(images && action=="image-close-ready") {roomClosingApproved=true;Close();return;}
            if(images && action=="image-close-cancel") roomClosePending=false;
            if(action=="hostSettings" && auxiliary) {bool wasSignedIn=signedIn;signedIn=message.ContainsKey("signedIn") && message["signedIn"] is bool && (bool)message["signedIn"];if(computer&&wasSignedIn!=signedIn)await ComputerSession(signedIn);if(video&&wasSignedIn&&!signedIn)await VideoLogout();}
            if(video&&action!=null&&action.StartsWith("video-",StringComparison.Ordinal))await VideoMessage(action,message,e);
            if(computer&&signedIn&&action!=null&&action.StartsWith("computer-",StringComparison.Ordinal))await ComputerMessage(action,message);
            if(images && signedIn && (action=="image-output-folder" || action=="image-reveal")) await ImageFile(action,message);
            if(images && signedIn && action!=null && action.StartsWith("photo-",StringComparison.Ordinal)) await PhotoFile(action,message,e);
            if(action=="hostSettings" && !auxiliary) {
                signedIn=message.ContainsKey("signedIn") && message["signedIn"] is bool && (bool)message["signedIn"];
                closeToTray=message.ContainsKey("closeToTray") && message["closeToTray"] is bool && (bool)message["closeToTray"];
                minimizeOnCapture=!message.ContainsKey("minimizeOnCapture") || !(message["minimizeOnCapture"] is bool) || (bool)message["minimizeOnCapture"];
                desiredHotkey=message.ContainsKey("captureHotkey")?message["captureHotkey"] as string:CaptureHotkey.Default;
                tray.Visible=true;
                if(!signedIn) {recordingHotkey=false;hotkeys.Suspend();capturePending=false;}
                else if(!recordingHotkey && !savingHotkey) ApplyHotkey();
            }
            if(action=="hotkey-recording" && !auxiliary && signedIn && !savingHotkey) {
                recordingHotkey=message.ContainsKey("active") && message["active"] is bool && (bool)message["active"];
                if(recordingHotkey) hotkeys.Suspend();else ApplyHotkey();
            }
            if(action=="hotkey-save") await SaveHotkey(message);
            if(action=="capture") await BeginCapture(message.ContainsKey("mode")?message["mode"] as string:"region",message.ContainsKey("parentId")?message["parentId"] as string:null);
            if(action=="capture-finished") {
                capturePending=false;
                if(message.ContainsKey("success") && message["success"] is bool && (bool)message["success"]) { tray.BalloonTipTitle="小羊工作箱";tray.BalloonTipText="截图已保存";tray.ShowBalloonTip(2500); }
                else Restore();
            }
            if(action=="screenshot-file") await ScreenshotFile(message);
            if (action == "theme") { int dark = message.ContainsKey("theme") && (string)message["theme"] == "dark" ? 1 : 0; DwmSetWindowAttribute(Handle,20,ref dark,4); }
            if (action == "export" && message.ContainsKey("data") && message["data"] is string) {
                string content = (string)message["data"]; serializer.DeserializeObject(content);
                using(var save = new SaveFileDialog()) { save.Title = room ? "导出房间方案" : "导出网络测试报告"; save.Filter = room ? "房间方案 (*.room.json)|*.room.json" : "JSON 测试报告 (*.json)|*.json"; save.FileName = (room ? "小羊房间设计-" : "小羊网络测试-") + DateTime.Now.ToString("yyyyMMdd-HHmmss") + (room ? ".room.json" : ".json");
                    if(save.ShowDialog(this) == DialogResult.OK) { File.WriteAllText(save.FileName, content, new System.Text.UTF8Encoding(false)); view.CoreWebView2.PostWebMessageAsJson("{\"type\":\"exported\"}"); }
                }
            }
        } catch(Exception ex) { Post(new {type="native-error",message=ex is WebException?"文件读取失败，请重新登录后重试":ex.Message}); }
    }
    void ApplyHotkey() {
        bool ok=signedIn && hotkeys.Apply(desiredHotkey);
        Post(new {type="hotkey-status",available=ok,hotkey=desiredHotkey});
    }
    async Task PhotoFile(string action, Dictionary<string,object> message, CoreWebView2WebMessageReceivedEventArgs args) {
        try {
            using(var client=await NativeClient()) {
                client.Headers["X-Workbox-Native-Files"]=nativeFilesToken;
                client.Headers["Origin"]=origin;
                var serializer=new JavaScriptSerializer();
                string[] paths=null;bool folder=false;
                if(action=="photo-import-files") {
                    using(var picker=new OpenFileDialog()) {
                        picker.Title="添加照片";picker.Multiselect=true;
                        picker.Filter="照片|*.arw;*.dng;*.jpg;*.jpeg;*.png;*.webp;*.avif;*.tif;*.tiff";
                        if(picker.ShowDialog(this)==DialogResult.OK) paths=picker.FileNames;
                    }
                } else if(action=="photo-drop") {
                    // Only OS-backed File objects grant a path. Never accept paths in page JSON.
                    paths=args.AdditionalObjects.OfType<CoreWebView2File>().Select(f=>f.Path).ToArray();
                    if(paths.Length==0 || paths.Any(p=>string.IsNullOrEmpty(p)||!Path.IsPathRooted(p)||!File.Exists(p))) throw new IOException("请拖入本机照片文件");
                } else if(action=="photo-import-folder" || action=="photo-output-folder") {
                    using(var picker=new FolderBrowserDialog()) {
                        picker.Description=action=="photo-import-folder"?"添加文件夹中的照片（不包含子文件夹）":"选择照片导出文件夹";
                        if(picker.ShowDialog(this)==DialogResult.OK) {
                            if(action=="photo-import-folder") {paths=new[]{picker.SelectedPath};folder=true;}
                            else {client.Headers["Content-Type"]="application/json";await client.UploadStringTaskAsync(origin+"/api/photos/output","POST",serializer.Serialize(new {path=picker.SelectedPath}));}
                        }
                    }
                } else if(action=="photo-reveal") {
                    string query="";Guid id;
                    if(message.ContainsKey("photoId")) {if(!Guid.TryParse(message["photoId"] as string,out id))throw new IOException("照片不存在");query="?id="+id;}
                    var result=serializer.Deserialize<Dictionary<string,object>>(await client.DownloadStringTaskAsync(origin+"/api/photos/reveal"+query));
                    string path=result["path"] as string;bool isFolder=result["folder"] is bool&&(bool)result["folder"];
                    if(string.IsNullOrEmpty(path)||!Path.IsPathRooted(path)||path.Contains("\"")||(isFolder?!Directory.Exists(path):!File.Exists(path)))throw new IOException("文件已移动或删除");
                    Process.Start(new ProcessStartInfo("explorer.exe",(isFolder?"":"/select,")+"\""+path+"\""){UseShellExecute=false});
                } else if(action=="photo-recipe") {
                    string data=message.ContainsKey("data")?message["data"] as string:null;
                    if(data==null||data.Length>100000)throw new IOException("编辑参数无效");serializer.DeserializeObject(data);
                    using(var save=new SaveFileDialog()) {
                        save.Title="导出编辑参数";save.Filter="小羊编辑参数 (*.xiaoyang.json)|*.xiaoyang.json";save.FileName="照片调整.xiaoyang.json";
                        if(save.ShowDialog(this)==DialogResult.OK) {
                            if(!save.FileName.EndsWith(".xiaoyang.json",StringComparison.OrdinalIgnoreCase))throw new IOException("请使用 .xiaoyang.json 扩展名");
                            File.WriteAllText(save.FileName,data,new System.Text.UTF8Encoding(false));
                        }
                    }
                }
                if(paths!=null) {
                    if(paths.Length>500)throw new IOException("单次最多导入 500 张，请分批选择");
                    client.Headers["Content-Type"]="application/json";
                    await client.UploadStringTaskAsync(origin+"/api/photos/import-paths","POST",serializer.Serialize(new {paths=paths,folder=folder}));
                }
            }
            Post(new {type="photo-native-finished"});
        } catch(Exception ex) {
            string messageText=ex.Message;
            var web=ex as WebException;
            if(web!=null&&web.Response!=null)try{using(var reader=new StreamReader(web.Response.GetResponseStream())){var body=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());if(body.ContainsKey("error"))messageText=body["error"] as string;}}catch{messageText="照片操作失败，请重试";}
            Post(new {type="photo-native-error",message=messageText});
        }
    }
    async Task ImageFile(string action, Dictionary<string,object> message) {
        try {
            using(var client=await NativeClient()) {
                client.Headers["X-Workbox-Native-Files"]=nativeFilesToken;
                var serializer=new JavaScriptSerializer();
                if(action=="image-output-folder") {
                    using(var picker=new FolderBrowserDialog()) {
                        picker.Description="选择图片输出文件夹";picker.ShowNewFolderButton=true;
                        if(picker.ShowDialog(this)==DialogResult.OK) {
                            client.Headers["Origin"]=origin;client.Headers["Content-Type"]="application/json";
                            await client.UploadStringTaskAsync(origin+"/api/images/output","POST",serializer.Serialize(new {path=picker.SelectedPath}));
                        }
                    }
                    Post(new {type="image-folder-selected"});
                } else {
                    Guid jobId,imageId;string query="";
                    if(message.ContainsKey("jobId") && message["jobId"]!=null) {
                        if(!Guid.TryParse(message["jobId"] as string,out jobId)) return;
                        query="?job="+jobId.ToString();
                    }
                    if(message.ContainsKey("imageId") && message["imageId"]!=null) {
                        if(query.Length==0 || !Guid.TryParse(message["imageId"] as string,out imageId)) return;
                        query+="&image="+imageId.ToString();
                    }
                    var result=serializer.Deserialize<Dictionary<string,object>>(await client.DownloadStringTaskAsync(origin+"/api/images/reveal"+query));
                    string path=result["path"] as string;
                    if(string.IsNullOrEmpty(path) || !Path.IsPathRooted(path) || path.Contains("\"")) throw new IOException("输出文件不存在");
                    bool folder=result["folder"] is bool && (bool)result["folder"];
                    if(folder ? !Directory.Exists(path) : !File.Exists(path)) throw new IOException("输出文件已被移动或删除");
                    Process.Start(new ProcessStartInfo("explorer.exe",(folder?"":"/select,")+"\""+path+"\"") {UseShellExecute=false});
                }
            }
        } catch(Exception ex) { Post(new {type="image-native-error",message=ex is WebException?"文件夹操作失败，请重新登录后重试":ex.Message}); }
    }
    async Task SaveHotkey(Dictionary<string,object> message) {
        if(auxiliary || !message.ContainsKey("requestId")) return;
        string requestId=message["requestId"] as string;
        if(savingHotkey || !signedIn) {Post(new {type="hotkey-saved",requestId=requestId,error="请稍后再试"});return;}
        savingHotkey=true;
        try {
            // Restore the old binding while reserving/saving a new one.
            hotkeys.Apply(desiredHotkey);
            using(var reservation=hotkeys.Reserve(message.ContainsKey("hotkey")?message["hotkey"] as string:null))
            using(var client=await NativeClient()) {
                client.Headers["Origin"]=origin;client.Headers["Content-Type"]="application/json";
                var serializer=new JavaScriptSerializer();
                string json=await client.UploadStringTaskAsync(origin+"/api/preferences","PATCH",serializer.Serialize(new {captureHotkey=reservation.Value}));
                if(!signedIn || IsDisposed) throw new InvalidOperationException("登录已失效");
                reservation.Commit();desiredHotkey=reservation.Value;recordingHotkey=false;
                Post(new {type="hotkey-status",available=true,hotkey=desiredHotkey});
                Post(new {type="hotkey-saved",requestId=requestId,preferences=serializer.DeserializeObject(json)});
            }
        } catch(Exception ex) {
            // Return to recording so pressing the old shortcut cannot capture.
            if(recordingHotkey) hotkeys.Suspend();
            Post(new {type="hotkey-saved",requestId=requestId,error=ex is WebException?"保存失败，请重新登录后重试":ex.Message});
        } finally {savingHotkey=false;}
    }
    async Task<byte[]> GetImage(string id) {
        using(var client=await NativeClient()) return await client.DownloadDataTaskAsync(origin+"/api/screenshots/"+id+"/image");
    }
    async Task<WebClient> NativeClient() {
        var client=new WebClient();client.Encoding=System.Text.Encoding.UTF8;client.Headers["X-Workbox-Desktop"]=token;
        var cookies=await view.CoreWebView2.CookieManager.GetCookiesAsync(origin);
        client.Headers["Cookie"]=string.Join("; ",cookies.Where(c=>c.Name=="workbox_session").Select(c=>c.Name+"="+c.Value));
        return client;
    }
    async Task ScreenshotFile(Dictionary<string,object> message) {
        if(!signedIn || auxiliary || !message.ContainsKey("ids") || !message.ContainsKey("operation")) return;
        var values=message["ids"] as object[]; if(values==null || values.Length<1 || values.Length>100) return;
        var ids=new List<string>();foreach(var value in values) { Guid id;if(!(value is string) || !Guid.TryParse((string)value,out id)) return;ids.Add(id.ToString()); }
        string operation=message["operation"] as string;
        if(operation=="reveal") {
            using(var client=await NativeClient()) {
                var info=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(await client.DownloadStringTaskAsync(origin+"/api/screenshots/"+ids[0]+"/native"));
                string path=Path.GetFullPath(info["path"]), expected=Path.GetFullPath(Path.Combine(dataDir,"screenshots","originals"))+Path.DirectorySeparatorChar;
                if(!path.StartsWith(expected,StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) throw new Exception("截图文件不存在");
                Process.Start(new ProcessStartInfo("explorer.exe","/select,\""+path+"\"") { UseShellExecute=true });
            }
            return;
        }
        if(operation=="copy") { using(var stream=new MemoryStream(await GetImage(ids[0]))) using(var source=Image.FromStream(stream)) Clipboard.SetImage(source); Post(new {type="native-done",message="已复制"});return; }
        if(operation!="save" && operation!="export") return;
        using(var save=new SaveFileDialog()) {
            bool zip=operation=="export";save.Title=zip?"导出截图":"另存截图";save.Filter=zip?"ZIP 压缩包 (*.zip)|*.zip":"PNG 图片 (*.png)|*.png";
            save.FileName="小羊截图-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+(zip?".zip":".png");
            if(save.ShowDialog(this)!=DialogResult.OK) return;
            // Complete reads before touching the destination, so expired login cannot
            // truncate an existing export. Temporary files are removed on failure.
            string temp=save.FileName+"."+Guid.NewGuid().ToString("N")+".tmp";
            try {
                if(zip) {
                    long total=0;
                    using(var stream=File.Create(temp)) using(var archive=new ZipArchive(stream,ZipArchiveMode.Create)) {
                        foreach(string id in ids) { byte[] bytes=await GetImage(id);total+=bytes.Length;if(total>512L*1024*1024) throw new Exception("单次导出不能超过 512 MB");using(var entry=archive.CreateEntry(id+".png",CompressionLevel.Fastest).Open()) entry.Write(bytes,0,bytes.Length); }
                    }
                } else { byte[] bytes=await GetImage(ids[0]);File.WriteAllBytes(temp,bytes); }
                if(File.Exists(save.FileName)) File.Replace(temp,save.FileName,null);else File.Move(temp,save.FileName);
                Post(new {type="native-done",message="已保存"});
            } finally { if(File.Exists(temp)) File.Delete(temp); }
        }
    }
}
