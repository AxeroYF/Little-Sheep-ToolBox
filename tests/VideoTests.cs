using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using System.Collections.Generic;

class VideoTests {
    static void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);}
    static object Data(object value){return VideoData.Json.DeserializeObject(VideoData.Json.Serialize(value));}
    static void Reject(Action action,string name){try{action();}catch(IOException){Console.WriteLine("PASS "+name);return;}throw new Exception(name);}
    static void Wait(Func<bool> condition,string name,int ms=10000){var until=DateTime.UtcNow.AddMilliseconds(ms);while(DateTime.UtcNow<until){Application.DoEvents();if(condition()){Console.WriteLine("PASS "+name);return;}Thread.Sleep(60);}throw new Exception(name);}
    [STAThread] static int Main(string[] args){try{
        string root=args[0],component=args[1],baseUrl=args[2],fixture=Path.Combine(root,"测试视频.avi");
        Check(VideoData.ServerUrl(baseUrl+"/jellyfin/web/index.html#!/home")==baseUrl+"/jellyfin/","reverse proxy path normalization");
        Reject(()=>VideoData.NetworkUrl("file:///C:/secret"),"network inputs reject local files");
        Reject(()=>VideoData.NetworkUrl("https://user:password@localhost/video"),"URL user credentials rejected");
        Reject(()=>VideoData.Header("test\r\nAuthorization: password"),"header injection rejected");
        Reject(()=>VideoData.Playlist("#EXTM3U\n#EXT-X-TARGETDURATION:10\nsegment.ts",baseUrl+"/hls.m3u8",true),"HLS not expanded as playlist");
        Reject(()=>VideoData.Playlist("#EXTM3U\nfile:///C:/secret",baseUrl+"/list.m3u",true),"remote playlist cannot read local files");
        var items=VideoData.Playlist("#EXTM3U\n#EXTINF:-1,测试影片\nmovie.avi?token=example",baseUrl+"/folder/list.m3u",true);Check(items.Length==1&&items[0].name=="测试影片"&&items[0].location==baseUrl+"/folder/movie.avi?token=example","M3U labels and relative URLs");
        var library=new VideoLibrary();VideoData.Add(library,new[]{VideoData.Local(fixture),items[0]});VideoData.Add(library,items);Check(library.items.Count==2,"playlist deduplication");
        library.servers.Add(new VideoServer{name="Private server",token="test-access-secret"});var file=Path.Combine(root,"library.dat");VideoData.Save(file,library);Check(!Encoding.UTF8.GetString(File.ReadAllBytes(file)).Contains("test-access-secret"),"server token protected on disk");Check(VideoData.Load(file).servers[0].token=="test-access-secret","encrypted history round trip");
        var api=new VideoServers(library.deviceId);var server=api.Login("jellyfin",baseUrl+"/jellyfin/web/index.html","test-user","test-password","Test Jellyfin").GetAwaiter().GetResult();
        Check(server.userId=="user1"&&server.token=="testtoken","Jellyfin login");
        var views=api.Browse(server,"","",0).GetAwaiter().GetResult();Check(VideoJson.Items(VideoJson.Get(Data(views),"items")).Length==1,"library views");
        var children=api.Browse(server,"library1","",0).GetAwaiter().GetResult();Check(VideoJson.Items(VideoJson.Get(Data(children),"items")).Length==2,"media and series listing");
        var playback=api.Playback(server,"movie1",false).GetAwaiter().GetResult();Check(playback.position==2000&&playback.url.Contains("api_key=testtoken")&&playback.url.Contains("/jellyfin/Videos/movie1/stream"),"authenticated source and server resume");
        var emby=api.Login("emby",baseUrl+"/reverse","test-user","test-password","Test Emby").GetAwaiter().GetResult();Check(emby.url==baseUrl+"/reverse/emby/","Emby reverse proxy route");
        var transcode=api.Playback(server,"movie1",true).GetAwaiter().GetResult();Check(transcode.url.Contains("master.m3u8")&&transcode.method=="Transcode","HLS transcode negotiation");
        using(var window=new Form{ShowInTaskbar=false,Opacity=0,Size=new Size(320,200)}){
            window.Show();window.Hide();using(var player=new VideoCore(component,window.Handle,false)){
                player.Play(fixture,true,500,"","");Wait(()=>player.Snapshot().state=="playing"&&player.Snapshot().time>300,"actual local AVI playback");
                var state=player.Snapshot();Check(state.width==160&&state.height==90&&state.duration>10000&&state.seekable,"real dimensions duration and seekability");
                player.Pause(true);Wait(()=>player.Snapshot().state=="paused","pause");player.Seek(5000);player.Pause(false);Wait(()=>player.Snapshot().time>=4800,"seek and resume");player.Rate(1.5f);Check(Math.Abs(player.Snapshot().rate-1.5)<0.01,"playback rate");
                string snapshot=Path.Combine(root,"frame.png");Check(player.Capture(snapshot),"native snapshot request");Wait(()=>File.Exists(snapshot),"native snapshot written");using(var image=new Bitmap(snapshot)){Check(image.Width==160&&image.Height==90,"snapshot actual decoded pixels");}
                player.AddSubtitle(Path.Combine(root,"字幕.srt"));Wait(()=>player.Snapshot().subtitleTracks.Length>1,"external Unicode subtitle");player.Stop();Check(player.Snapshot().state=="stopped","stop releases playback");
                player.Play(playback.url,false,500,"XiaoyangTest/1.0","");Wait(()=>player.Snapshot().state=="playing"&&player.Snapshot().time>300,"real authenticated HTTP video");player.Seek(playback.position);Wait(()=>player.Snapshot().time>1800,"network range seek and resume");
                api.Report(playback,"",2000,false,true,70).GetAwaiter().GetResult();api.Report(playback,"/Progress",3000,true,true,70).GetAwaiter().GetResult();api.Report(playback,"/Stopped",3100,false,true,70).GetAwaiter().GetResult();player.Stop();
                player.Play(transcode.url,false,500,"","");player.Volume(0);Wait(()=>player.Snapshot().state=="playing"&&player.Snapshot().time>300,"actual HLS segment decoding");Wait(()=>player.Snapshot().audioTracks.Length>1,"HLS audio tracks");Check(player.Snapshot().volume==0,"volume control");player.Seek(6000);Wait(()=>player.Snapshot().time>=5800,"HLS seek");player.Stop();
            }
        }
        File.WriteAllText(Path.Combine(root,"native-passed.txt"),"Real LibVLC playback, networking, controls, encrypted storage and server protocol passed");return 0;
    }catch(Exception e){Console.Error.WriteLine(e);return 1;}}
}
