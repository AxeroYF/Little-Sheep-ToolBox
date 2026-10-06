// Fixed LibRaw 0.22.2 C ABI. Original RAW files are opened read-only through its Unicode API.
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.Threading;

internal static class RawPhoto {
    const string Dll="libraw.dll";
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_init(uint flags);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)] static extern int libraw_open_wfile(IntPtr raw,string path);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_close(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_version();
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_strerror(int code);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_get_iparams(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_get_lensinfo(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_get_imgother(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_get_iwidth(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_get_iheight(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern float libraw_get_cam_mul(IntPtr raw,int i);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern float libraw_get_pre_mul(IntPtr raw,int i);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_unpack(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_adjust_to_raw_inset_crop(IntPtr raw,uint mask,float maxcrop);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_unpack_thumb(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern int libraw_dcraw_process(IntPtr raw);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_dcraw_make_mem_image(IntPtr raw,out int error);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libraw_dcraw_make_mem_thumb(IntPtr raw,out int error);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_dcraw_clear_mem(IntPtr image);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_demosaic(IntPtr raw,int value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_output_color(IntPtr raw,int value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_output_bps(IntPtr raw,int value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_user_mul(IntPtr raw,int index,float value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_no_auto_bright(IntPtr raw,int value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_bright(IntPtr raw,float value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_gamma(IntPtr raw,int index,float value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_highlight(IntPtr raw,int value);
    [DllImport(Dll,CallingConvention=CallingConvention.Cdecl)] static extern void libraw_set_fbdd_noiserd(IntPtr raw,int value);
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static string TextAt(IntPtr ptr,int offset,int count) {byte[] b=new byte[count];Marshal.Copy(IntPtr.Add(ptr,offset),b,0,count);int n=Array.IndexOf(b,(byte)0);return Encoding.UTF8.GetString(b,0,n<0?count:n).Trim();}
    static float FloatAt(IntPtr ptr,int offset) {byte[] b=new byte[4];Marshal.Copy(IntPtr.Add(ptr,offset),b,0,4);return BitConverter.ToSingle(b,0);}
    static void Check(int code) {if(code!=0)throw new InvalidOperationException(Marshal.PtrToStringAnsi(libraw_strerror(code)));}
    static double Number(Dictionary<string,object> m,string key,double fallback,double low,double high) {object v;if(!m.TryGetValue(key,out v))return fallback;double n=Convert.ToDouble(v,CultureInfo.InvariantCulture);if(double.IsNaN(n)||double.IsInfinity(n)||n<low||n>high)throw new ArgumentException("Invalid "+key);return n;}
    static void CopyPixels(IntPtr data,uint size,Stream output) {byte[] chunk=new byte[1024*1024];for(uint i=0;i<size;) {int n=(int)Math.Min((uint)chunk.Length,size-i);Marshal.Copy(IntPtr.Add(data,checked((int)i)),chunk,0,n);output.Write(chunk,0,n);i+=(uint)n;}}
    static void Entry(BinaryWriter w,ushort tag,ushort type,uint count,uint value){w.Write(tag);w.Write(type);w.Write(count);w.Write(value);}
    static void SaveMemory(IntPtr image,string path) {
        int type=Marshal.ReadInt32(image);ushort height=(ushort)Marshal.ReadInt16(image,4),width=(ushort)Marshal.ReadInt16(image,6),colors=(ushort)Marshal.ReadInt16(image,8),bits=(ushort)Marshal.ReadInt16(image,10);uint size=(uint)Marshal.ReadInt32(image,12);
        if(size==0||size>400000000)throw new InvalidDataException("Decoded image is too large");
        using(var stream=new FileStream(path,FileMode.CreateNew,FileAccess.Write)) {
            if(type==1) {CopyPixels(IntPtr.Add(image,16),size,stream);return;}
            if(type!=2||colors!=3||(bits!=8&&bits!=16)||size!=(uint)width*height*colors*(bits/8))throw new InvalidDataException("Unsupported decoded image");
            // A minimal uncompressed RGB TIFF avoids ANSI filename APIs and preserves 16-bit samples.
            using(var w=new BinaryWriter(stream)) {
                const uint bitsOffset=158,pixelsOffset=164;
                w.Write((byte)'I');w.Write((byte)'I');w.Write((ushort)42);w.Write((uint)8);w.Write((ushort)12);
                Entry(w,256,4,1,width);Entry(w,257,4,1,height);Entry(w,258,3,3,bitsOffset);Entry(w,259,3,1,1);
                Entry(w,262,3,1,2);Entry(w,273,4,1,pixelsOffset);Entry(w,274,3,1,1);Entry(w,277,3,1,3);
                Entry(w,278,4,1,height);Entry(w,279,4,1,size);Entry(w,284,3,1,1);Entry(w,339,3,1,1);
                w.Write((uint)0);w.Write(bits);w.Write(bits);w.Write(bits);CopyPixels(IntPtr.Add(image,16),size,stream);
            }
        }
    }
    static int Main() {
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        IntPtr raw=IntPtr.Zero,image=IntPtr.Zero;Timer watchdog=null;
        try {
            string line=Console.ReadLine();if(line==null||line.Length>65536)throw new ArgumentException("Invalid request");
            var request=Json.Deserialize<Dictionary<string,object>>(line);string action=(string)request["action"];
            if(action=="version"){Console.WriteLine(Json.Serialize(new {version=Marshal.PtrToStringAnsi(libraw_version())}));return 0;}
            int parent=(int)Number(request,"parentPid",0,0,int.MaxValue);
            if(parent>0)watchdog=new Timer(_=>{try{if(Process.GetProcessById(parent).HasExited)Environment.Exit(2);}catch{Environment.Exit(2);}},null,1000,1000);
            string input=Path.GetFullPath((string)request["input"]);
            if(new FileInfo(input).Length>256L*1024*1024)throw new InvalidDataException("RAW file exceeds 256 MB");
            raw=libraw_init(0);if(raw==IntPtr.Zero)throw new OutOfMemoryException();Check(libraw_open_wfile(raw,input));
            libraw_adjust_to_raw_inset_crop(raw,1,.55f);
            int width=(ushort)Marshal.ReadInt16(raw,14),height=(ushort)Marshal.ReadInt16(raw,12);
            if(width<1||height<1||(long)width*height>60000000)throw new InvalidDataException("RAW exceeds 60 megapixels");
            // offsets from pinned libraw_types.h: image pointer (8), sizes.flip (32).
            int flip=Marshal.ReadInt32(raw,40);IntPtr ip=libraw_get_iparams(raw),lens=libraw_get_lensinfo(raw),other=libraw_get_imgother(raw);
            var metadata=new {make=TextAt(ip,4,64),camera=TextAt(ip,68,64),lens=TextAt(lens,148,128),width=(flip==5||flip==6)?height:width,height=(flip==5||flip==6)?width:height,flip=flip,iso=FloatAt(other,0),shutter=FloatAt(other,4),aperture=FloatAt(other,8),focalLength=FloatAt(other,12),timestamp=Marshal.ReadInt64(other,16),version=Marshal.PtrToStringAnsi(libraw_version())};
            if(action=="identify"){Console.WriteLine(Json.Serialize(metadata));return 0;}
            string output=Path.GetFullPath((string)request["output"]);if(input.Equals(output,StringComparison.OrdinalIgnoreCase))throw new ArgumentException("Original file is read-only");
            int error;
            if(action=="thumbnail") {Check(libraw_unpack_thumb(raw));image=libraw_dcraw_make_mem_thumb(raw,out error);Check(error);}
            else if(action=="develop") {
                libraw_set_output_color(raw,1);libraw_set_output_bps(raw,16);libraw_set_no_auto_bright(raw,1);libraw_set_demosaic(raw,3);
                // Linear 16-bit sRGB base. Exposure/tone controls run consistently on this base in a worker.
                libraw_set_gamma(raw,0,1);libraw_set_gamma(raw,1,1);libraw_set_bright(raw,1);
                libraw_set_highlight(raw,2);libraw_set_fbdd_noiserd(raw,(int)Number(request,"denoise",0,0,1));
                bool daylight=request.ContainsKey("whiteBalance")&&(string)request["whiteBalance"]=="daylight";
                double temperature=Number(request,"temperature",0,-100,100),tint=Number(request,"tint",0,-100,100);
                for(int c=0;c<4;c++){float value=daylight?libraw_get_pre_mul(raw,c):libraw_get_cam_mul(raw,c);if(value<=0)value=libraw_get_pre_mul(raw,c);if(value<=0)value=c==3?libraw_get_cam_mul(raw,1):1;double gain=c==0?Math.Exp(temperature*.006):c==2?Math.Exp(-temperature*.006):Math.Exp(-tint*.004);libraw_set_user_mul(raw,c,(float)(value*gain));}
                Check(libraw_unpack(raw));Check(libraw_dcraw_process(raw));image=libraw_dcraw_make_mem_image(raw,out error);Check(error);
            } else throw new ArgumentException("Unsupported action");
            if(image==IntPtr.Zero)throw new InvalidDataException("No decoded image");SaveMemory(image,output);Console.WriteLine(Json.Serialize(metadata));return 0;
        } catch(Exception e) {Console.Error.WriteLine(Json.Serialize(new {error=e.Message}));return 1;}
        finally {if(image!=IntPtr.Zero)libraw_dcraw_clear_mem(image);if(raw!=IntPtr.Zero)libraw_close(raw);if(watchdog!=null)watchdog.Dispose();}
    }
}
