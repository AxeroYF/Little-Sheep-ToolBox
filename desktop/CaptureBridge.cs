using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Small local bridge: ShareX actions publish a completed-file receipt; the
// service validates the receipt and owns importing, identity and persistence.
internal static class CaptureBridge {
    delegate bool EnumWindow(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long a,b; public uint flags; public UIntPtr min,max; public uint limit; public UIntPtr affinity; public uint priority,scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct JobLimit { public BasicLimit basic; public Io io; public UIntPtr a,b,c,d; }
    static string Quote(string value) { return "\"" + value.Replace("\"","\\\"") + "\""; }
    static int Run(string[] args) {
        IntPtr job = CreateJobObject(IntPtr.Zero,null);
        var limits = new JobLimit(); limits.basic.flags=0x2000; // Kill only this issued component when its bridge dies.
        int size=Marshal.SizeOf(limits); IntPtr pointer=Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits,pointer,false);
            if(job==IntPtr.Zero || !SetInformationJobObject(job,9,pointer,(uint)size)) throw new Exception("无法创建截图任务");
            var arguments = new System.Text.StringBuilder();
            for(int i=2;i<args.Length;i++) { if(i>2) arguments.Append(' '); arguments.Append(Quote(args[i])); }
            using(var process=Process.Start(new ProcessStartInfo(args[1],arguments.ToString()) { UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(args[1]) })) {
                if(!AssignProcessToJobObject(job,process.Handle)) { process.Kill(); throw new Exception("无法隔离截图进程"); }
                bool seen=false; DateTime lastVisible=DateTime.UtcNow;
                while(!process.WaitForExit(300)) {
                    bool visible=false;
                    EnumWindows((h,p)=> { uint pid; GetWindowThreadProcessId(h,out pid); if(pid==process.Id && IsWindowVisible(h)) visible=true; return true; },IntPtr.Zero);
                    if(visible) { seen=true; lastVisible=DateTime.UtcNow; }
                    // ShareX -autoclose does not exit after Escape or editor Save.
                    // Wait for file actions to finish before ending our private idle instance.
                    if((DateTime.UtcNow-lastVisible).TotalSeconds>(seen?5:45)) { process.Kill(); process.WaitForExit(); return seen?0:4; }
                }
                return process.ExitCode;
            }
        } finally { Marshal.FreeHGlobal(pointer); if(job!=IntPtr.Zero) CloseHandle(job); }
    }
    static int Main(string[] args) {
        try {
            if(args.Length>=3 && args[0]=="run") return Run(args);
            if (args.Length == 3 && args[0] == "receipt") {
                string target = Path.GetFullPath(args[1]);
                string input = Path.GetFullPath(args[2]);
                if (!File.Exists(input)) return 2;
                string temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
                File.WriteAllText(temp, new JavaScriptSerializer().Serialize(new { path = input }), new System.Text.UTF8Encoding(false));
                if (File.Exists(target)) File.Delete(temp); else File.Move(temp, target);
                return 0;
            }
            if (args.Length == 3 && args[0] == "thumbnail") {
                using (var source = Image.FromFile(args[1])) {
                    if (source.Width < 1 || source.Height < 1 || (long)source.Width * source.Height > 100000000) return 3;
                    double scale = Math.Min(1, Math.Min(480.0 / source.Width, 320.0 / source.Height));
                    using (var target = new Bitmap(Math.Max(1,(int)(source.Width * scale)), Math.Max(1,(int)(source.Height * scale)))) {
                        using (var graphics = Graphics.FromImage(target)) {
                            graphics.Clear(Color.FromArgb(238,240,244));
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            graphics.DrawImage(source, new Rectangle(0,0,target.Width,target.Height));
                        }
                        target.Save(args[2], ImageFormat.Jpeg);
                    }
                    Console.WriteLine(new JavaScriptSerializer().Serialize(new { width = source.Width, height = source.Height }));
                }
                return 0;
            }
            return 1;
        } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }
}
