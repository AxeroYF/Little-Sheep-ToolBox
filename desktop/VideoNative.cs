using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Net.Http;
using Microsoft.Web.WebView2.Core;

internal partial class WorkboxWindow {
    Panel videoSurface;System.Windows.Forms.Timer videoTimer;
    VideoCore videoCore;VideoLibrary videoLibrary;VideoServers videoServers;VideoItem videoItem;ServerPlayback videoRemote;
    VideoCore.Status videoLast;string videoOwner,videoStore,videoError="";bool videoBusy,videoEngineBusy,videoReportBusy,videoClosing,videoFull,videoPinned,videoLoop;
    bool videoSurfaceWanted;int videoEpoch;long videoResume;DateTime videoOpened,videoSaved,videoReported;
    Rectangle videoWindowBounds;FormWindowState videoWindowState;FormBorderStyle videoBorder;
    void InitVideo(){
        string frames=Path.Combine(dataDir,"video","frames");if(Directory.Exists(frames))foreach(string file in Directory.GetFiles(frames,"*.png")){Guid id;if(Guid.TryParseExact(Path.GetFileNameWithoutExtension(file),"N",out id))try{File.Delete(file);}catch{}}
        videoSurface=new Panel{BackColor=Color.Black,Visible=false,TabStop=true};Controls.Add(videoSurface);
        videoSurface.DoubleClick+=(s,e)=>VideoFullscreen();
        videoTimer=new System.Windows.Forms.Timer{Interval=500};videoTimer.Tick+=VideoTick;videoTimer.Start();
    }
    async Task<bool> VideoSession(){
        if(!signedIn)throw new IOException("请先登录工作箱");
        using(var client=await NativeClient()){
            var session=VideoJson.Map(VideoData.Json.DeserializeObject(await client.DownloadStringTaskAsync(origin+"/api/session")));string owner=VideoJson.Text(VideoJson.Get(session,"user"),"id");
            if(string.IsNullOrEmpty(owner))throw new IOException("请先登录工作箱");
            if(owner!=videoOwner){await StopVideo(true);videoOwner=owner;videoStore=Path.Combine(dataDir,"video",VideoJson.Id(owner)+".dat");videoLibrary=VideoData.Load(videoStore);videoServers=new VideoServers(videoLibrary.deviceId);}
            return true;
        }
    }
    object VideoPublic(){return new {
        items=videoLibrary.items.Select(i=>new {i.id,i.name,i.kind,i.position,i.duration,i.playedAt,detail=i.kind=="local"?Path.GetDirectoryName(i.location):i.kind=="url"?VideoData.Label(i.location):"服务器媒体"}).ToArray(),
        servers=videoLibrary.servers.Select(s=>new {s.id,s.name,s.kind,address=s.url,user=s.userName}).ToArray(),
        available=File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"components","LibVLC-3.0.24","libvlc.dll"))
    };}
    void SaveVideo(){if(videoLibrary!=null&&videoStore!=null)VideoData.Save(videoStore,videoLibrary);}
    void VideoLibraryChanged(){SaveVideo();Post(new {type="video-library",data=VideoPublic()});}
    async void VideoTick(object sender,EventArgs e){
        if(videoEngineBusy||videoClosing||videoCore==null||!signedIn)return;
        try{
            var snapshot=videoCore.Snapshot();videoLast=snapshot;
            if(snapshot.state=="playing"||snapshot.state=="paused")videoOpened=DateTime.UtcNow;
            if(videoResume>0&&snapshot.state=="playing"&&snapshot.seekable){videoCore.Seek(videoResume);videoResume=0;}
            if(videoItem!=null){
                if(snapshot.duration>0)videoItem.duration=snapshot.duration;
                if((snapshot.state=="playing"||snapshot.state=="paused")&&snapshot.time>0)videoItem.position=snapshot.time;
                if(snapshot.state=="ended")videoItem.position=0;
                if((DateTime.UtcNow-videoSaved).TotalSeconds>5){SaveVideo();videoSaved=DateTime.UtcNow;}
            }
            if(snapshot.state=="error")videoError="无法播放，请检查文件、链接或服务器权限；服务器视频可尝试兼容转码";
            if((snapshot.state=="opening"||snapshot.state=="buffering")&&(DateTime.UtcNow-videoOpened).TotalSeconds>30){videoError="连接超时，请检查播放源后重试";await StopVideo(false);}
            Post(new {type="video-state",id=videoItem==null?null:videoItem.id,data=snapshot,error=videoError,fullscreen=videoFull,pinned=videoPinned});
            if(videoRemote!=null&&!videoReportBusy&&(DateTime.UtcNow-videoReported).TotalSeconds>10&&(snapshot.state=="playing"||snapshot.state=="paused")){
                videoReportBusy=true;var remote=videoRemote;var api=videoServers;videoReported=DateTime.UtcNow;
                try{await api.Report(remote,"/Progress",snapshot.time,snapshot.state=="paused",snapshot.seekable,snapshot.volume);}catch{if(videoRemote==remote)Post(new {type="video-notice",message="播放正常，服务器进度暂未同步"});}finally{videoReportBusy=false;}
            }
            if(snapshot.state=="ended"&&!videoBusy&&videoItem!=null){
                string next=videoLoop?videoItem.id:videoLibrary.items.SkipWhile(i=>i.id!=videoItem.id).Skip(1).Select(i=>i.id).FirstOrDefault();
                if(next!=null){videoBusy=true;try{await PlayVideo(next,false,false);}finally{videoBusy=false;}}else await StopVideo(false);
            }
        }catch{videoError="播放状态读取失败，请重新打开视频";}
    }
    async Task StopVideo(bool clear){
        bool previous=videoEngineBusy;videoEngineBusy=true;try{
        if(videoCore!=null){
            if(videoItem!=null&&videoLast!=null){videoItem.position=videoLast.state=="ended"?0:Math.Max(0,videoLast.time);if(videoLast.duration>0)videoItem.duration=videoLast.duration;SaveVideo();}
            var remote=videoRemote;videoRemote=null;var last=videoLast;var api=videoServers;
            if(remote!=null&&last!=null)try{await Task.WhenAny(api.Report(remote,"/Stopped",last.time,false,last.seekable,last.volume),Task.Delay(1200));}catch{}
            var engine=videoCore;await Task.Run(()=>engine.Stop());
            if(clear){videoCore=null;await Task.Run(()=>engine.Dispose());videoItem=null;videoLast=null;videoSurface.Visible=false;}
        }
        }finally{videoEngineBusy=previous;}
    }
    async Task PlayVideo(string id,bool fromStart,bool transcode){
        int epoch=videoEpoch;videoEngineBusy=true;try{
        var item=videoLibrary.items.FirstOrDefault(i=>i.id==id);if(item==null)throw new IOException("未找到视频");
        await StopVideo(false);videoError="";videoOpened=DateTime.UtcNow;videoLast=null;videoItem=item;videoResume=fromStart?0:item.position;videoRemote=null;
        string source=item.location;
        if(item.kind=="server"){
            var server=videoLibrary.servers.FirstOrDefault(s=>s.id==item.serverId);if(server==null)throw new IOException("请重新连接影视服务器");
            videoRemote=await videoServers.Playback(server,item.itemId,transcode);source=videoRemote.url;videoResume=fromStart?0:videoRemote.position;
        }else if(item.kind=="local")source=VideoData.FileSource(source);else source=VideoData.NetworkUrl(source);
        if(epoch!=videoEpoch||!signedIn)throw new IOException("登录状态已改变");
        if(videoCore==null)videoCore=new VideoCore(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"components","LibVLC-3.0.24"),videoSurface.Handle);
        videoSurface.Visible=videoSurfaceWanted;videoSurface.BringToFront();var core=videoCore;
        await Task.Run(()=>core.Play(source,item.kind=="local",item.cacheMs,item.agent,item.referer));
        if(epoch!=videoEpoch||!signedIn){await StopVideo(true);throw new IOException("登录状态已改变");}
        item.playedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();VideoLibraryChanged();videoOpened=DateTime.UtcNow;videoReported=DateTime.UtcNow;
        if(videoRemote!=null){var remote=videoRemote;try{await videoServers.Report(remote,"",videoResume,false,true,70);}catch{Post(new {type="video-notice",message="视频已打开，服务器进度暂未同步"});}}
        }finally{videoEngineBusy=false;}
    }
    void VideoFullscreen(){
        if(!videoFull){videoWindowBounds=Bounds;videoWindowState=WindowState;videoBorder=FormBorderStyle;WindowState=FormWindowState.Normal;FormBorderStyle=FormBorderStyle.None;Bounds=Screen.FromControl(this).Bounds;videoFull=true;}
        else{FormBorderStyle=videoBorder;WindowState=FormWindowState.Normal;Bounds=videoWindowBounds;WindowState=videoWindowState;videoFull=false;}
        Post(new {type="video-window",fullscreen=videoFull,pinned=videoPinned});
    }
    void VideoRectangle(Dictionary<string,object> message){
        videoSurfaceWanted=VideoJson.Flag(message,"visible");double width=Convert.ToDouble(VideoJson.Get(message,"viewportWidth")??0),height=Convert.ToDouble(VideoJson.Get(message,"viewportHeight")??0);
        if(width<1||height<1){videoSurface.Visible=false;return;}
        double sx=view.ClientSize.Width/width,sy=view.ClientSize.Height/height;
        var bounds=new Rectangle((int)(VideoJson.Number(message,"x")*sx)+view.Left,(int)(VideoJson.Number(message,"y")*sy)+view.Top,(int)(VideoJson.Number(message,"width")*sx),(int)(VideoJson.Number(message,"height")*sy));
        bounds.Intersect(ClientRectangle);videoSurface.Bounds=bounds;videoSurface.Visible=signedIn&&videoCore!=null&&videoItem!=null&&videoSurfaceWanted&&bounds.Width>1&&bounds.Height>1;if(videoSurface.Visible)videoSurface.BringToFront();
    }
    async Task VideoMessage(string action,Dictionary<string,object> message,CoreWebView2WebMessageReceivedEventArgs args){
        if(action=="video-rect"){VideoRectangle(message);return;}
        string requestId=VideoJson.Text(message,"requestId");Guid request;if(!Guid.TryParse(requestId,out request))return;
        bool control=new[]{"video-pause","video-seek","video-volume","video-rate","video-audio","video-subtitle","video-delay","video-aspect","video-fullscreen","video-pin","video-loop"}.Contains(action);
        if(videoClosing||videoEngineBusy||(videoBusy&&!control)){Post(new {type="video-response",requestId=requestId,error="正在处理，请稍候"});return;}
        if(!control)videoBusy=true;int epoch=videoEpoch;
        try{
            await VideoSession();if(epoch!=videoEpoch)throw new IOException("登录状态已改变");
            object result=null;
            if(action=="video-init")result=VideoPublic();
            else if(action=="video-files"||action=="video-drop"){
                string[] paths=null;
                if(action=="video-files")using(var picker=new OpenFileDialog()){picker.Title="打开视频";picker.Multiselect=true;picker.Filter="视频与播放列表|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.ts;*.m2ts;*.mpg;*.mpeg;*.wmv;*.flv;*.m3u;*.m3u8;*.mp3;*.flac;*.wav|所有文件|*.*";if(picker.ShowDialog(this)==DialogResult.OK)paths=picker.FileNames;}
                else paths=args.AdditionalObjects.OfType<CoreWebView2File>().Select(f=>f.Path).ToArray();
                if(paths!=null&&paths.Length>0){if(paths.Length>200)throw new IOException("单次最多添加 200 个文件");var items=new List<VideoItem>();foreach(string path in paths){string extension=Path.GetExtension(path).ToLowerInvariant();if(extension==".m3u"||extension==".m3u8"){if(new FileInfo(path).Length>2097152)throw new IOException("播放列表不能超过 2 MB");items.AddRange(VideoData.Playlist(File.ReadAllText(path),path,false));}else items.Add(VideoData.Local(path));}VideoData.Add(videoLibrary,items);VideoLibraryChanged();if(items.Count>0){var first=items[0];string id=videoLibrary.items.First(i=>i.kind==first.kind&&i.location==first.location).id;await PlayVideo(id,false,false);}result=VideoPublic();}
            }else if(action=="video-link"){
                var item=VideoData.Link(VideoJson.Text(message,"url"),VideoJson.Text(message,"name"),VideoJson.Text(message,"agent"),VideoJson.Text(message,"referer"),(int)VideoJson.Number(message,"cacheMs"));
                if(VideoJson.Flag(message,"playlist")){
                    using(var http=new HttpClient{Timeout=TimeSpan.FromSeconds(15),MaxResponseContentBufferSize=2097152}){if(!string.IsNullOrEmpty(item.agent))http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent",item.agent);if(!string.IsNullOrEmpty(item.referer))http.DefaultRequestHeaders.Referrer=new Uri(item.referer);string text=await http.GetStringAsync(VideoData.NetworkUrl(item.location,true));if(epoch!=videoEpoch||!signedIn)throw new IOException("登录状态已改变");var list=VideoData.Playlist(text,item.location,true);foreach(var entry in list){entry.agent=item.agent;entry.referer=item.referer;entry.cacheMs=item.cacheMs;}VideoData.Add(videoLibrary,list);}
                    VideoLibraryChanged();result=VideoPublic();
                }else{VideoData.Add(videoLibrary,new[]{item});VideoLibraryChanged();result=videoLibrary.items.First(i=>i.kind=="url"&&i.location==item.location).id;}
            }else if(action=="video-play")await PlayVideo(VideoJson.Text(message,"id"),VideoJson.Flag(message,"fromStart"),VideoJson.Flag(message,"transcode"));
            else if(action=="video-connect"){
                var connected=await videoServers.Login(VideoJson.Text(message,"kind"),VideoJson.Text(message,"url"),VideoJson.Text(message,"username"),VideoJson.Text(message,"password"),VideoJson.Text(message,"name"));
                if(epoch!=videoEpoch)throw new IOException("登录状态已改变");
                var old=videoLibrary.servers.FirstOrDefault(s=>s.url==connected.url&&s.userName==connected.userName);if(old!=null){connected.id=old.id;videoLibrary.servers.Remove(old);}if(videoLibrary.servers.Count>=12)throw new IOException("最多保存 12 个服务器");videoLibrary.servers.Add(connected);VideoLibraryChanged();result=connected.id;
            }else if(action=="video-browse"){
                var server=videoLibrary.servers.FirstOrDefault(s=>s.id==VideoJson.Text(message,"serverId"));if(server==null)throw new IOException("请连接服务器");result=await videoServers.Browse(server,VideoJson.Text(message,"parent"),VideoJson.Text(message,"search"),(int)VideoJson.Number(message,"start"));
            }else if(action=="video-server-play"){
                string server=VideoJson.Text(message,"serverId"),itemId=VideoJson.Id(VideoJson.Text(message,"itemId"));if(!videoLibrary.servers.Any(s=>s.id==server))throw new IOException("服务器不存在");
                var item=new VideoItem{kind="server",serverId=server,itemId=itemId,name=VideoJson.Text(message,"name"),duration=VideoJson.Number(message,"duration")};VideoData.Add(videoLibrary,new[]{item});var saved=videoLibrary.items.First(i=>i.serverId==server&&i.itemId==itemId);await PlayVideo(saved.id,VideoJson.Flag(message,"fromStart"),VideoJson.Flag(message,"transcode"));
            }else if(action=="video-server-remove"){
                string id=VideoJson.Text(message,"id");var server=videoLibrary.servers.FirstOrDefault(s=>s.id==id);if(server==null)throw new IOException("服务器不存在");if(videoItem!=null&&videoItem.serverId==id)await StopVideo(true);try{await videoServers.Request(server,"Sessions/Logout",new {});}catch{}videoLibrary.servers.Remove(server);videoLibrary.items.RemoveAll(i=>i.serverId==id);VideoLibraryChanged();
            }else if(action=="video-remove"){
                string id=VideoJson.Text(message,"id");if(videoItem!=null&&videoItem.id==id)await StopVideo(true);videoLibrary.items.RemoveAll(i=>i.id==id);VideoLibraryChanged();
            }else if(action=="video-clear") {await StopVideo(true);videoLibrary.items.Clear();VideoLibraryChanged();}
            else if(action=="video-stop")await StopVideo(false);
            else if(action=="video-fullscreen")VideoFullscreen();
            else if(action=="video-pin"){videoPinned=!videoPinned;TopMost=videoPinned;Post(new {type="video-window",fullscreen=videoFull,pinned=videoPinned});}
            else if(action=="video-loop")videoLoop=VideoJson.Flag(message,"enabled");
            else if(videoCore!=null){
                if(action=="video-pause"){videoCore.Pause(VideoJson.Flag(message,"paused"));videoReported=DateTime.MinValue;}
                else if(action=="video-seek")videoCore.Seek(VideoJson.Number(message,"time"));
                else if(action=="video-volume")videoCore.Volume((int)VideoJson.Number(message,"value"));
                else if(action=="video-rate")videoCore.Rate((float)Convert.ToDouble(VideoJson.Get(message,"value")));
                else if(action=="video-audio")videoCore.Audio((int)VideoJson.Number(message,"id"));
                else if(action=="video-subtitle")videoCore.Subtitle((int)VideoJson.Number(message,"id"));
                else if(action=="video-delay")videoCore.SubtitleDelay((int)VideoJson.Number(message,"value"));
                else if(action=="video-aspect")videoCore.Aspect(VideoJson.Text(message,"value"));
                else if(action=="video-subtitle-file")using(var picker=new OpenFileDialog()){picker.Title="加载字幕";picker.Filter="字幕|*.srt;*.ass;*.ssa;*.vtt;*.sub";if(picker.ShowDialog(this)==DialogResult.OK)videoCore.AddSubtitle(picker.FileName);}
                else if(action=="video-capture"){
                    string folder=Path.Combine(dataDir,"video","frames");Directory.CreateDirectory(folder);string path=Path.Combine(folder,Guid.NewGuid().ToString("N")+".png");
                    try{
                        var core=videoCore;if(!await Task.Run(()=>core.Capture(path)))throw new IOException("截帧失败");
                        for(int i=0;i<50&&!File.Exists(path);i++)await Task.Delay(100);
                        if(!File.Exists(path)||new FileInfo(path).Length>50L*1024*1024)throw new IOException("截帧超出大小限制");
                        using(var client=await NativeClient()){client.Headers["Origin"]=origin;client.Headers["Content-Type"]="application/octet-stream";client.Headers["X-Workbox-Native-Files"]=nativeFilesToken;await client.UploadDataTaskAsync(origin+"/api/screenshots/video-frame?name="+Uri.EscapeDataString("视频截帧 "+DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")),"POST",File.ReadAllBytes(path));}
                        Post(new {type="video-notice",message="已保存到工作箱截图管理"});
                    }finally{if(File.Exists(path))File.Delete(path);}
                }
                else throw new IOException("不支持的播放操作");
            }else throw new IOException("请先打开视频");
            if(epoch!=videoEpoch)throw new IOException("登录状态已改变");Post(new {type="video-response",requestId=requestId,data=result});
        }catch(Exception ex){string error=ex is HttpRequestException||ex is TaskCanceledException?"服务器连接失败或超时，请检查地址和网络":ex is IOException?ex.Message:"操作失败，请检查媒体源或重新连接服务器";Post(new {type="video-response",requestId=requestId,error=error});}
        finally{if(!control)videoBusy=false;}
    }
    async Task VideoLogout(){videoEpoch++;videoSurface.Visible=false;while(videoBusy)await Task.Delay(50);await StopVideo(true);videoLibrary=null;videoOwner=null;videoServers=null;videoStore=null;}
    async void CloseVideo(){if(videoClosing)return;videoClosing=true;videoEpoch++;videoTimer.Stop();try{while(videoBusy)await Task.Delay(50);await StopVideo(true);}catch{}finally{Close();}}
    void DisposeVideo(){if(!video)return;if(videoTimer!=null)videoTimer.Dispose();if(videoCore!=null){videoCore.Dispose();videoCore=null;}if(videoSurface!=null)videoSurface.Dispose();}
}
