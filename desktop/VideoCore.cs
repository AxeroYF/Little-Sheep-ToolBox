// Minimal LibVLC 3.x C ABI adapter. Video/audio stay in native memory and render to HWND.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal sealed class VideoCore : IDisposable {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_new(int count,IntPtr args);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_release(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_media_player_new(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_release(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_set_hwnd(IntPtr p,IntPtr hwnd);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_media_new_path(IntPtr p,byte[] path);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_media_new_location(IntPtr p,byte[] path);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_add_option(IntPtr p,byte[] option);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_release(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_set_media(IntPtr p,IntPtr media);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_play(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_set_pause(IntPtr p,int pause);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_stop(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_get_state(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern long libvlc_media_player_get_time(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_set_time(IntPtr p,long value);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern long libvlc_media_player_get_length(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_is_seekable(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_set_rate(IntPtr p,float rate);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern float libvlc_media_player_get_rate(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_audio_set_volume(IntPtr p,int volume);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_audio_get_volume(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_audio_get_track_description(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_video_get_spu_description(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_track_description_list_release(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_audio_get_track(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_audio_set_track(IntPtr p,int id);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_video_get_spu(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_video_set_spu(IntPtr p,int id);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_video_set_spu_delay(IntPtr p,long us);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_add_slave(IntPtr p,int type,byte[] uri,int select);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_video_set_aspect_ratio(IntPtr p,byte[] ratio);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_video_take_snapshot(IntPtr p,uint n,byte[] path,uint w,uint h);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_video_get_size(IntPtr p,uint n,out uint w,out uint h);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern float libvlc_media_player_get_fps(IntPtr p);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_video_set_key_input(IntPtr p,uint enabled);
    [DllImport("libvlc.dll",CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_video_set_mouse_input(IntPtr p,uint enabled);
    [StructLayout(LayoutKind.Sequential)] struct NativeTrack {public int id;public IntPtr name;public IntPtr next;}
    internal sealed class Track {public int id;public string name;}
    internal sealed class Status {public string state;public long time,duration;public bool seekable;public int volume,audio,subtitle;public float rate,fps;public uint width,height;public Track[] audioTracks,subtitleTracks;}
    static readonly object initialization=new object();static bool loaded;
    readonly object gate=new object();IntPtr engine,player;bool disposed,volumePending=true;int desiredVolume=70;
    static byte[] Utf8(string text){return Encoding.UTF8.GetBytes(text+"\0");}
    static string ReadUtf8(IntPtr p){if(p==IntPtr.Zero)return "";int n=0;while(n<8192&&Marshal.ReadByte(p,n)!=0)n++;byte[] bytes=new byte[n];Marshal.Copy(p,bytes,0,n);return Encoding.UTF8.GetString(bytes);}
    public VideoCore(string component,IntPtr hwnd,bool hardware=true) {
        lock(initialization)if(!loaded){
            // Only use our fixed absolute component path; dependencies resolve beside these DLLs.
            foreach(string dll in new[]{"libvlccore.dll","libvlc.dll"})if(LoadLibraryEx(Path.Combine(component,dll),IntPtr.Zero,0x00000008)==IntPtr.Zero)throw new IOException("VLC 组件加载失败");
            loaded=true;
        }
        var args=new[]{"--quiet","--no-video-title-show","--no-osd","--no-media-library","--no-metadata-network-access","--no-sub-autodetect-file","--avcodec-hw="+(hardware?"any":"none")};
        var strings=args.Select(a=>Marshal.StringToHGlobalAnsi(a)).ToArray();IntPtr array=Marshal.AllocHGlobal(IntPtr.Size*strings.Length);
        try{Marshal.Copy(strings,0,array,strings.Length);engine=libvlc_new(strings.Length,array);}finally{foreach(var p in strings)Marshal.FreeHGlobal(p);Marshal.FreeHGlobal(array);}
        if(engine==IntPtr.Zero)throw new IOException("VLC 初始化失败");
        player=libvlc_media_player_new(engine);if(player==IntPtr.Zero){libvlc_release(engine);engine=IntPtr.Zero;throw new IOException("无法创建播放器");}
        libvlc_media_player_set_hwnd(player,hwnd);libvlc_video_set_key_input(player,0);libvlc_video_set_mouse_input(player,0);libvlc_audio_set_volume(player,70);
    }
    public void Play(string source,bool local,int cacheMs,string agent,string referer) {lock(gate){
        if(disposed)throw new ObjectDisposedException("VideoCore");
        libvlc_media_player_stop(player);volumePending=true;
        IntPtr media=local?libvlc_media_new_path(engine,Utf8(source)):libvlc_media_new_location(engine,Utf8(source));
        if(media==IntPtr.Zero)throw new IOException("无法打开媒体");
        try{
            libvlc_media_add_option(media,Utf8(":network-caching="+Math.Max(300,Math.Min(10000,cacheMs))));
            libvlc_media_add_option(media,Utf8(":http-reconnect"));
            libvlc_media_add_option(media,Utf8(":ipv4-timeout=10000"));
            if(!string.IsNullOrEmpty(agent))libvlc_media_add_option(media,Utf8(":http-user-agent="+VideoData.Header(agent)));
            if(!string.IsNullOrEmpty(referer))libvlc_media_add_option(media,Utf8(":http-referrer="+VideoData.NetworkUrl(referer,true)));
            libvlc_media_player_set_media(player,media);if(libvlc_media_player_play(player)!=0)throw new IOException("播放未能启动");
        }finally{libvlc_media_release(media);}
    }}
    Track[] Tracks(bool audio){var list=new List<Track>();IntPtr first=audio?libvlc_audio_get_track_description(player):libvlc_video_get_spu_description(player);try{IntPtr p=first;while(p!=IntPtr.Zero&&list.Count<256){var t=(NativeTrack)Marshal.PtrToStructure(p,typeof(NativeTrack));list.Add(new Track{id=t.id,name=ReadUtf8(t.name)});p=t.next;}}finally{if(first!=IntPtr.Zero)libvlc_track_description_list_release(first);}return list.ToArray();}
    public Status Snapshot(){lock(gate){if(disposed)return new Status{state="stopped",audioTracks=new Track[0],subtitleTracks=new Track[0]};uint w,h;libvlc_video_get_size(player,0,out w,out h);int state=libvlc_media_player_get_state(player);if(volumePending&&(state==3||state==4)&&libvlc_audio_get_track(player)>=0){libvlc_audio_set_volume(player,desiredVolume);volumePending=false;}return new Status{state=new[]{"idle","opening","buffering","playing","paused","stopped","ended","error"}[Math.Max(0,Math.Min(7,state))],time=Math.Max(0,libvlc_media_player_get_time(player)),duration=Math.Max(0,libvlc_media_player_get_length(player)),seekable=libvlc_media_player_is_seekable(player)!=0,volume=libvlc_audio_get_volume(player),rate=libvlc_media_player_get_rate(player),width=w,height=h,fps=libvlc_media_player_get_fps(player),audio=libvlc_audio_get_track(player),subtitle=libvlc_video_get_spu(player),audioTracks=Tracks(true),subtitleTracks=Tracks(false)};}}
    public void Pause(bool paused){lock(gate)libvlc_media_player_set_pause(player,paused?1:0);}
    public void Seek(long ms){lock(gate)if(libvlc_media_player_is_seekable(player)!=0)libvlc_media_player_set_time(player,Math.Max(0,ms));}
    public void Volume(int value){lock(gate){desiredVolume=Math.Max(0,Math.Min(100,value));libvlc_audio_set_volume(player,desiredVolume);volumePending=true;}}
    public void Rate(float value){lock(gate)if(libvlc_media_player_set_rate(player,Math.Max(0.25f,Math.Min(4,value)))!=0)throw new IOException("当前播放源不支持此倍速");}
    public void Audio(int id){lock(gate)if(libvlc_audio_set_track(player,id)!=0)throw new IOException("音轨不可用");}
    public void Subtitle(int id){lock(gate)if(libvlc_video_set_spu(player,id)!=0)throw new IOException("字幕不可用");}
    public void SubtitleDelay(int ms){lock(gate)libvlc_video_set_spu_delay(player,(long)Math.Max(-60000,Math.Min(60000,ms))*1000);}
    public void AddSubtitle(string path){lock(gate)if(libvlc_media_player_add_slave(player,0,Utf8(new Uri(path).AbsoluteUri),1)!=0)throw new IOException("字幕加载失败");}
    public void Aspect(string value){if(!new[]{"","16:9","4:3","1:1"}.Contains(value))return;lock(gate)libvlc_video_set_aspect_ratio(player,Utf8(value));}
    public bool Capture(string path){lock(gate)return libvlc_video_take_snapshot(player,0,Utf8(path),0,0)==0;}
    public void Stop(){lock(gate)if(!disposed)libvlc_media_player_stop(player);}
    public void Dispose(){lock(gate){if(disposed)return;disposed=true;if(player!=IntPtr.Zero){libvlc_media_player_stop(player);libvlc_media_player_release(player);player=IntPtr.Zero;}if(engine!=IntPtr.Zero){libvlc_release(engine);engine=IntPtr.Zero;}}}
}
