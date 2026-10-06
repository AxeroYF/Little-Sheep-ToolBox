using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal sealed class VideoItem {
    public string id=Guid.NewGuid().ToString("N"),name,kind,location,serverId,itemId,agent="",referer="";
    public long position,duration,playedAt;public int cacheMs=1500;
}
internal sealed class VideoServer {
    public string id=Guid.NewGuid().ToString("N"),name,kind,url,userId,userName,token;
}
internal sealed class VideoLibrary {
    public int version=1;public string deviceId=Guid.NewGuid().ToString("N");
    public List<VideoItem> items=new List<VideoItem>();public List<VideoServer> servers=new List<VideoServer>();
}
internal static class VideoData {
    internal static JavaScriptSerializer Json {get{return new JavaScriptSerializer{MaxJsonLength=4194304};}}
    internal static readonly string[] Extensions={".mp4",".mkv",".mov",".avi",".webm",".m4v",".ts",".m2ts",".mpg",".mpeg",".wmv",".flv",".vob",".m4a",".mp3",".flac",".wav",".ogg"};
    public static string Header(string text){if(text==null)return "";if(text.Length>512||text.Any(c=>c<' '||c==127))throw new IOException("请求参数无效");return text;}
    public static string NetworkUrl(string value,bool httpOnly=false){
        Uri uri;if(string.IsNullOrWhiteSpace(value)||value.Length>8192||value.Any(char.IsControl)||!Uri.TryCreate(value.Trim(),UriKind.Absolute,out uri)||!(uri.Scheme=="http"||uri.Scheme=="https"||(!httpOnly&&uri.Scheme=="rtsp")))throw new IOException("请输入 HTTP、HTTPS 或 RTSP 播放地址");
        if(!string.IsNullOrEmpty(uri.UserInfo))throw new IOException("请使用服务器登录，不要在地址中填写账号密码");
        return uri.AbsoluteUri;
    }
    public static string ServerUrl(string input){
        Uri uri=new Uri(NetworkUrl(input,true));if(uri.Query.Length>0)throw new IOException("请输入服务器根地址，例如 https://example.com/jellyfin");
        var builder=new UriBuilder(uri);string path=builder.Path;
        int web=path.IndexOf("/web",StringComparison.OrdinalIgnoreCase);if(web>=0&&(path.Length==web+4||path[web+4]=='/'))path=path.Substring(0,web);
        builder.Path=path.TrimEnd('/')+"/";builder.Fragment="";return builder.Uri.AbsoluteUri;
    }
    public static string Label(string source){try{var uri=new Uri(source);return uri.Host+Uri.UnescapeDataString(uri.AbsolutePath);}catch{return "网络视频";}}
    public static string FileSource(string path){
        if(!Path.IsPathRooted(path)||!File.Exists(path)||!Extensions.Contains(Path.GetExtension(path).ToLowerInvariant()))throw new IOException("不支持的媒体文件或文件已移动");return Path.GetFullPath(path);
    }
    public static VideoItem Local(string path){path=FileSource(path);return new VideoItem{name=Path.GetFileName(path),location=path,kind="local"};}
    public static VideoItem Link(string url,string name,string agent,string referer,int cache){url=NetworkUrl(url);return new VideoItem{kind="url",location=url,name=string.IsNullOrWhiteSpace(name)?Label(url):name.Trim().Substring(0,Math.Min(160,name.Trim().Length)),agent=Header(agent),referer=string.IsNullOrWhiteSpace(referer)?"":NetworkUrl(referer,true),cacheMs=Math.Max(300,Math.Min(10000,cache))};}
    public static VideoItem[] Playlist(string content,string source,bool remote){
        if(content.Length>2097152)throw new IOException("播放列表不能超过 2 MB");
        // HLS manifests belong to the native decoder, not the application's episode queue.
        if(content.IndexOf("#EXT-X-",StringComparison.OrdinalIgnoreCase)>=0)throw new IOException("这是 HLS 流，请使用“播放链接”打开");
        var items=new List<VideoItem>();string name=null;
        foreach(string raw in content.TrimStart('\uFEFF').Split('\n')){
            string line=raw.Trim();if(line.StartsWith("#EXTINF:",StringComparison.OrdinalIgnoreCase)){int comma=line.IndexOf(',');name=comma<0?null:line.Substring(comma+1);continue;}
            if(line.Length==0||line.StartsWith("#"))continue;
            VideoItem item;
            if(remote){item=Link(new Uri(new Uri(source),line).AbsoluteUri,name,"","",1500);}
            else if(line.StartsWith("http://",StringComparison.OrdinalIgnoreCase)||line.StartsWith("https://",StringComparison.OrdinalIgnoreCase)||line.StartsWith("rtsp://",StringComparison.OrdinalIgnoreCase))item=Link(line,name,"","",1500);
            else{item=Local(Path.IsPathRooted(line)?line:Path.Combine(Path.GetDirectoryName(source),line));if(!string.IsNullOrWhiteSpace(name))item.name=name;}
            items.Add(item);name=null;if(items.Count>=200)break;
        }
        if(items.Count==0)throw new IOException("播放列表中没有可用视频");return items.ToArray();
    }
    public static VideoLibrary Load(string file){
        if(!File.Exists(file))return new VideoLibrary();
        if(new FileInfo(file).Length>8388608)throw new IOException("播放器数据过大");
        try{var bytes=ProtectedData.Unprotect(File.ReadAllBytes(file),Encoding.UTF8.GetBytes("Xiaoyang.Video.v1"),DataProtectionScope.CurrentUser);var library=Json.Deserialize<VideoLibrary>(Encoding.UTF8.GetString(bytes));if(library==null||library.version!=1||library.items==null||library.servers==null)throw new IOException();return library;}catch{throw new IOException("播放器数据无法解密，原文件已保留");}
    }
    public static void Save(string file,VideoLibrary library){
        Directory.CreateDirectory(Path.GetDirectoryName(file));byte[] data=ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Serialize(library)),Encoding.UTF8.GetBytes("Xiaoyang.Video.v1"),DataProtectionScope.CurrentUser);string temp=file+".tmp";
        try{File.WriteAllBytes(temp,data);if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
    public static void Add(VideoLibrary library,IEnumerable<VideoItem> values){var pending=new List<VideoItem>();foreach(var item in values){if(library.items.Concat(pending).Any(i=>i.kind==item.kind&&i.location==item.location&&i.serverId==item.serverId&&i.itemId==item.itemId))continue;pending.Add(item);}if(library.items.Count+pending.Count>200)throw new IOException("播放列表最多保存 200 项，请先移除不需要的视频");library.items.AddRange(pending);}
}
