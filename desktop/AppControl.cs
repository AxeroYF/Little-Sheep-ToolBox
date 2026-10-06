// Fixed-catalog process control. No shell commands, forced kills or process-name-only matching.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

internal static class AppControl {
    internal const string Property="Xiaoyang.Workbox.ManagedExit.v1";
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process,int flags,StringBuilder name,ref int size);
    [DllImport("user32.dll",SetLastError=true)] static extern bool EnumWindows(Callback callback,IntPtr data);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    delegate bool Callback(IntPtr window,IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out int process);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window,string name);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window,int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    internal sealed class App {public string id{get;set;}public string path{get;set;}public bool managed{get;set;}public string detection{get;set;}}
    internal sealed class Request {public string action{get;set;}public App[] apps{get;set;}}
    internal static bool SamePath(string left,string right){return string.Equals(Path.GetFullPath(left),Path.GetFullPath(right),StringComparison.OrdinalIgnoreCase);}
    static bool Matches(string path,App app){if(SamePath(path,app.path))return true;if(!app.managed||!SamePath(Path.GetDirectoryName(path),Path.GetDirectoryName(app.path)))return false;string prefix=Path.GetFileNameWithoutExtension(app.path)+".previous-",stem=Path.GetFileNameWithoutExtension(path);long stamp;return stem.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)&&long.TryParse(stem.Substring(prefix.Length),out stamp);}
    static string PathOf(Process p){IntPtr handle=OpenProcess(0x1000,false,p.Id);if(handle==IntPtr.Zero)return null;try{var b=new StringBuilder(32768);int length=b.Capacity;return QueryFullProcessImageName(handle,0,b,ref length)?b.ToString():null;}finally{CloseHandle(handle);}}
    static object Run(App app,string action){
        if(!Path.IsPathRooted(app.path)||!app.path.EndsWith(".exe",StringComparison.OrdinalIgnoreCase))throw new ArgumentException();
        if(app.detection!=null&&app.detection!="process"&&app.detection!="window")throw new ArgumentException();
        bool requireWindow=app.detection=="window";
        var windows=new Dictionary<int,IntPtr>();
        var visible=new Dictionary<int,IntPtr>();
        // Minimized windows retain WS_VISIBLE. Hidden launchers and Chromium workers do not qualify.
        SetLastError(0);
        bool enumerated=EnumWindows((h,p)=>{int pid;GetWindowThreadProcessId(h,out pid);if(GetProp(h,Property)!=IntPtr.Zero)windows[pid]=h;if(IsWindowVisible(h)&&GetWindow(h,4)==IntPtr.Zero&&!visible.ContainsKey(pid))visible[pid]=h;return true;},IntPtr.Zero);
        // An empty desktop can return false with ERROR_SUCCESS; only a nonzero error is failure.
        if(!enumerated&&Marshal.GetLastWin32Error()!=0)throw new InvalidOperationException();
        int count=0,actionCount=0;bool unknown=false,canClose=false,canShow=false;long? since=null;
        foreach(var process in Process.GetProcesses())using(process)try{
            string stem=Path.GetFileNameWithoutExtension(app.path);if(!string.Equals(process.ProcessName,stem,StringComparison.OrdinalIgnoreCase)&&!(app.managed&&process.ProcessName.StartsWith(stem+".previous-",StringComparison.OrdinalIgnoreCase)))continue;
            if(process.SessionId!=Process.GetCurrentProcess().SessionId)continue;
            // Filter window-only apps before inspecting process paths: inaccessible renderer workers
            // without a user window must not turn a closed application into "unknown" or "running".
            IntPtr visibleWindow=IntPtr.Zero;if(requireWindow&&!visible.TryGetValue(process.Id,out visibleWindow))continue;
            string path=PathOf(process);if(path==null){unknown=true;continue;}if(!Matches(path,app))continue;
            count++;long started=(long)(process.StartTime.ToUniversalTime()-new DateTime(1970,1,1)).TotalMilliseconds;since=since.HasValue?Math.Min(since.Value,started):started;
            IntPtr window;bool protocol=windows.TryGetValue(process.Id,out window);if(requireWindow){window=visibleWindow;protocol=GetProp(window,Property)!=IntPtr.Zero;}else if(!protocol)window=process.MainWindowHandle;
            bool closable=window!=IntPtr.Zero&&(!app.managed||protocol);canClose|=closable;canShow|=window!=IntPtr.Zero;
            // Keep the process handle alive and re-check it immediately before sending a window message.
            string currentPath=PathOf(process);if(process.HasExited||currentPath==null||!Matches(currentPath,app))continue;
            int owner=0;if(window!=IntPtr.Zero)GetWindowThreadProcessId(window,out owner);if(owner!=process.Id)continue;
            if(requireWindow&&!IsWindowVisible(window))continue;
            if(action=="show"&&window!=IntPtr.Zero){if(protocol)PostMessage(window,RegisterWindowMessage("Xiaoyang.Workbox.Show.v1"),IntPtr.Zero,IntPtr.Zero);else {ShowWindowAsync(window,9);SetForegroundWindow(window);}actionCount++;}
            if(action=="close"&&closable){if(PostMessage(window,protocol?RegisterWindowMessage("Xiaoyang.Workbox.Exit.v1"):0x0010,IntPtr.Zero,IntPtr.Zero))actionCount++;}
        }catch{unknown=true;}
        return new {id=app.id,state=count>0?"running":unknown?"unknown":"stopped",instances=count,since=since,canClose=canClose,canShow=canShow,accepted=actionCount>0};
    }
    static int Main(){Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);try{var json=new JavaScriptSerializer();string input=Console.In.ReadToEnd();if(input.Length>65536)throw new ArgumentException();var request=json.Deserialize<Request>(input);if(request==null||request.apps==null||request.apps.Length>100||!new[]{"list","show","close"}.Contains(request.action))throw new ArgumentException();Console.WriteLine(json.Serialize(request.apps.Select(a=>Run(a,request.action)).ToArray()));return 0;}catch{Console.Error.WriteLine("Application control failed");return 1;}}
}
