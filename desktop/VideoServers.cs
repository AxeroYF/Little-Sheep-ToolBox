using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Collections;
using System.Collections.Generic;

internal static class VideoJson {
    public static Dictionary<string,object> Map(object o){return o as Dictionary<string,object>??new Dictionary<string,object>();}
    public static object Get(object o,string key){object result;return Map(o).TryGetValue(key,out result)?result:null;}
    public static string Text(object o,string key,string fallback=""){return Convert.ToString(Get(o,key))??fallback;}
    public static long Number(object o,string key){long value;return long.TryParse(Text(o,key),out value)?value:0;}
    public static bool Flag(object o,string key){return Get(o,key) is bool&&(bool)Get(o,key);}
    public static object[] Items(object o){var list=o as IEnumerable;return list==null||o is string?new object[0]:list.Cast<object>().ToArray();}
    public static string Id(string value){if(string.IsNullOrEmpty(value)||value.Length>160||value.Any(c=>!char.IsLetterOrDigit(c)&&c!='-'&&c!='_'))throw new IOException("媒体标识无效");return value;}
}
internal sealed class ServerPlayback {public VideoServer server;public string itemId,sourceId,sessionId,url,method;public long position;}
internal sealed class VideoServers {
    readonly string device;
    public VideoServers(string deviceId){device=VideoJson.Id(deviceId);}
    public static Uri Route(VideoServer server,string route){
        Uri root=new Uri(server.url),absolute;
        if(Uri.TryCreate(route,UriKind.Absolute,out absolute)&&!route.StartsWith("/"))return new Uri(VideoData.NetworkUrl(absolute.AbsoluteUri,true));
        if(route.StartsWith(root.AbsolutePath,StringComparison.Ordinal)&&root.AbsolutePath!="/")return new Uri(root.GetLeftPart(UriPartial.Authority)+route);
        return new Uri(root,route.TrimStart('/'));
    }
    public static bool SameOrigin(Uri a,Uri b){return a.Scheme==b.Scheme&&a.Host==b.Host&&a.Port==b.Port;}
    public async Task<object> Request(VideoServer server,string path,object body=null) {
        using(var timeout=new CancellationTokenSource(15000))
        using(var handler=new HttpClientHandler{AllowAutoRedirect=false,AutomaticDecompression=DecompressionMethods.GZip|DecompressionMethods.Deflate})
        using(var client=new HttpClient(handler)){
            Uri uri=Route(server,path);var root=new Uri(server.url);
            for(int redirect=0;redirect<4;redirect++){
                if(!SameOrigin(root,uri))throw new IOException("服务器跳转到其他地址，请使用最终服务器地址重新连接");
                using(var request=new HttpRequestMessage(body==null?HttpMethod.Get:HttpMethod.Post,uri)){
                    request.Headers.TryAddWithoutValidation("X-Emby-Authorization","MediaBrowser Client=\"Xiaoyang Video\", Device=\"Windows\", DeviceId=\""+device+"\", Version=\"0.1.0\""+(string.IsNullOrEmpty(server.token)?"":", Token=\""+VideoData.Header(server.token)+"\""));
                    if(!string.IsNullOrEmpty(server.token))request.Headers.TryAddWithoutValidation("X-Emby-Token",server.token);
                    request.Headers.UserAgent.ParseAdd("XiaoyangVideo/0.1.0");
                    if(body!=null)request.Content=new StringContent(VideoData.Json.Serialize(body),Encoding.UTF8,"application/json");
                    using(var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token).ConfigureAwait(false)){
                        if((int)response.StatusCode>=300&&(int)response.StatusCode<400&&response.Headers.Location!=null){uri=new Uri(uri,response.Headers.Location);continue;}
                        if(response.StatusCode==HttpStatusCode.Unauthorized||response.StatusCode==HttpStatusCode.Forbidden)throw new IOException("服务器登录失效或没有访问权限，请重新连接");
                        if(!response.IsSuccessStatusCode)throw new IOException("服务器请求失败（HTTP "+(int)response.StatusCode+"）");
                        using(var stream=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(var buffer=new MemoryStream()){
                            byte[] bytes=new byte[16384];int n;while((n=await stream.ReadAsync(bytes,0,bytes.Length,timeout.Token).ConfigureAwait(false))>0){buffer.Write(bytes,0,n);if(buffer.Length>4194304)throw new IOException("服务器响应过大");}
                            string json=Encoding.UTF8.GetString(buffer.ToArray());return string.IsNullOrWhiteSpace(json)?new Dictionary<string,object>():VideoData.Json.DeserializeObject(json);
                        }
                    }
                }
            }
        }
        throw new IOException("服务器重定向过多");
    }
    public async Task<VideoServer> Login(string kind,string address,string username,string password,string name){
        if(kind!="emby"&&kind!="jellyfin")throw new IOException("请选择 Emby 或 Jellyfin");
        if(string.IsNullOrWhiteSpace(username)||username.Length>128||password==null||password.Length>512)throw new IOException("请检查服务器账号和密码");
        var server=new VideoServer{kind=kind,url=VideoData.ServerUrl(address),name=string.IsNullOrWhiteSpace(name)?kind:name.Trim().Substring(0,Math.Min(80,name.Trim().Length)),userName=username};
        if(kind=="emby"&&!new Uri(server.url).AbsolutePath.TrimEnd('/').EndsWith("/emby",StringComparison.OrdinalIgnoreCase))server.url+="emby/";
        var result=await Request(server,"Users/AuthenticateByName",new {Username=username,Pw=password}).ConfigureAwait(false);
        server.token=VideoJson.Text(result,"AccessToken");server.userId=VideoJson.Id(VideoJson.Text(VideoJson.Get(result,"User"),"Id"));
        if(string.IsNullOrEmpty(server.token)||server.token.Length>1024||server.token.Any(c=>!char.IsLetterOrDigit(c)&&c!='-'&&c!='_'&&c!='.'))throw new IOException("服务器未返回有效登录令牌");
        return server;
    }
    public async Task<object> Browse(VideoServer server,string parent,string search,int start){
        string path;
        start=Math.Max(0,start);
        if(string.IsNullOrEmpty(parent)&&string.IsNullOrWhiteSpace(search))path="Users/"+VideoJson.Id(server.userId)+"/Views";
        else path="Users/"+VideoJson.Id(server.userId)+"/Items?Fields=MediaSources,Overview&Limit=60&StartIndex="+start+"&SortBy=SortName&SortOrder=Ascending"+(!string.IsNullOrEmpty(parent)?"&ParentId="+VideoJson.Id(parent):"")+(!string.IsNullOrWhiteSpace(search)?"&Recursive=true&IncludeItemTypes=Movie,Episode,Video,Series&SearchTerm="+Uri.EscapeDataString(search.Substring(0,Math.Min(120,search.Length))):"");
        var result=await Request(server,path).ConfigureAwait(false);
        return new {total=VideoJson.Number(result,"TotalRecordCount"),items=VideoJson.Items(VideoJson.Get(result,"Items")).Select(i=>new {id=VideoJson.Text(i,"Id"),name=VideoJson.Text(i,"Name"),type=VideoJson.Text(i,"Type"),folder=VideoJson.Flag(i,"IsFolder")||new[]{"Series","Season","BoxSet","CollectionFolder","Folder"}.Contains(VideoJson.Text(i,"Type")),year=VideoJson.Number(i,"ProductionYear"),episode=VideoJson.Number(i,"IndexNumber"),season=VideoJson.Number(i,"ParentIndexNumber"),series=VideoJson.Text(i,"SeriesName"),duration=VideoJson.Number(i,"RunTimeTicks")/10000,position=VideoJson.Number(VideoJson.Get(i,"UserData"),"PlaybackPositionTicks")/10000}).ToArray()};
    }
    public async Task<ServerPlayback> Playback(VideoServer server,string itemId,bool transcode){
        itemId=VideoJson.Id(itemId);
        var item=await Request(server,"Users/"+VideoJson.Id(server.userId)+"/Items/"+itemId).ConfigureAwait(false);
        long position=VideoJson.Number(VideoJson.Get(item,"UserData"),"PlaybackPositionTicks")/10000;
        var profile=new {Name="Xiaoyang VLC",MaxStreamingBitrate=120000000,MaxStaticBitrate=200000000,DirectPlayProfiles=new[]{new {Container="mp4,m4v,mkv,avi,mov,ts,m2ts,webm,mpg,mpeg",Type="Video",VideoCodec="h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1,mjpeg",AudioCodec="aac,mp3,ac3,eac3,dts,flac,opus,vorbis,pcm_s16le,pcm_s24le,truehd"}},TranscodingProfiles=new[]{new {Container="ts",Type="Video",VideoCodec="h264",AudioCodec="aac",Protocol="hls",Context="Streaming",MaxAudioChannels="2",BreakOnNonKeyFrames=true}},SubtitleProfiles=new[]{new {Format="srt",Method="Embed"},new {Format="ass",Method="Embed"},new {Format="subrip",Method="Embed"}}};
        var result=await Request(server,"Items/"+itemId+"/PlaybackInfo",new {UserId=server.userId,DeviceProfile=profile,StartTimeTicks=0L,IsPlayback=true,AutoOpenLiveStream=false,EnableDirectPlay=!transcode,EnableDirectStream=!transcode,EnableTranscoding=transcode,MaxStreamingBitrate=transcode?12000000:120000000}).ConfigureAwait(false);
        var source=VideoJson.Items(VideoJson.Get(result,"MediaSources")).FirstOrDefault();
        if(source==null)throw new IOException("服务器没有返回可播放媒体源");
        string sourceId=VideoJson.Text(source,"Id"),relative,method;
        if(transcode){relative=VideoJson.Text(source,"TranscodingUrl");method="Transcode";if(string.IsNullOrEmpty(relative))throw new IOException("服务器未提供转码流，请使用原画播放");}
        else{relative=VideoJson.Text(source,"DirectStreamUrl");if(string.IsNullOrEmpty(relative))relative="Videos/"+itemId+"/stream?Static=true&MediaSourceId="+Uri.EscapeDataString(sourceId)+"&DeviceId="+Uri.EscapeDataString(device);method="DirectPlay";}
        Uri uri=Route(server,relative);string url=uri.AbsoluteUri;
        if(SameOrigin(new Uri(server.url),uri)&&!System.Text.RegularExpressions.Regex.IsMatch(uri.Query,"(?:[?&])api_key=",System.Text.RegularExpressions.RegexOptions.IgnoreCase))url+=(uri.Query.Length==0?"?":"&")+"api_key="+Uri.EscapeDataString(server.token);
        return new ServerPlayback{server=server,itemId=itemId,sourceId=sourceId,sessionId=VideoJson.Text(result,"PlaySessionId"),url=url,position=position,method=method};
    }
    public Task<object> Report(ServerPlayback playback,string phase,long time,bool paused,bool seekable,int volume){return Request(playback.server,"Sessions/Playing"+phase,new {ItemId=playback.itemId,MediaSourceId=playback.sourceId,PlaySessionId=playback.sessionId,PositionTicks=Math.Max(0,time)*10000,IsPaused=paused,CanSeek=seekable,VolumeLevel=volume,IsMuted=volume==0,PlayMethod=playback.method,EventName="TimeUpdate"});}
}
