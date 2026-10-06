// SPDX-License-Identifier: GPL-3.0-or-later
// This independent adapter loads the unmodified ShareX 21.0 assemblies. Its
// source is shipped with the component under GPL, alongside upstream source.
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Diagnostics;

internal static class WorkboxShareXHost {
    const BindingFlags Static = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
    static readonly object OutputLock=new();
    static Type program=null!, taskManager=null!;
    static Form main=null!;
    static StreamWriter output=null!;
    static string? job;
    static bool executing;
    static DateTime quietSince;
    static bool activeWasVisible;
    static Stopwatch? started;
    static System.Threading.Timer observer=null!;
    static int observing;
    static void Emit(object value) { lock(OutputLock) {output.WriteLine(JsonSerializer.Serialize(value));output.Flush();} }
    static object? Get(string name)=>program.GetProperty(name,Static)!.GetValue(null);
    static void Set(string name,object value)=>program.GetProperty(name,Static)!.SetValue(null,value);

    [STAThread] static int Main() {
        output=new StreamWriter(Console.OpenStandardOutput()) {AutoFlush=true};
        // Keep our pipe protocol separate from any third-party Console output.
        Console.SetOut(TextWriter.Null);
        string root=AppContext.BaseDirectory;
        Directory.SetCurrentDirectory(root);
        AssemblyLoadContext.Default.Resolving+=(context,name)=> {
            string file=Path.Combine(root,name.Name+".dll");
            return File.Exists(file)?context.LoadFromAssemblyPath(file):null;
        };
        try {
            var assembly=Assembly.LoadFrom(Path.Combine(root,"ShareX.dll"));
            program=assembly.GetType("ShareX.Program",true)!;
            taskManager=assembly.GetType("ShareX.TaskManager",true)!;
            _=Task.Run(async()=> {
                try {
                    for(int i=0;i<400;i++) {
                        var window=Get("MainForm") as Form;
                        if(window!=null && window.IsHandleCreated && (bool)window.GetType().GetProperty("IsReady")!.GetValue(window)!) {main=window;break;}
                        await Task.Delay(50);
                    }
                    if(main==null) throw new Exception("ShareX 初始化超时");
                    main.BeginInvoke((Action)(()=> {
                        if(main.GetType().GetField("niTray",BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic)?.GetValue(main) is NotifyIcon tray) tray.Visible=false;
                        observer=new System.Threading.Timer(_=> {
                            if(Interlocked.Exchange(ref observing,1)!=0)return;
                            try {main.BeginInvoke((Action)(()=>{try{Observe();}finally{Interlocked.Exchange(ref observing,0);}}));}
                            catch {observer?.Dispose();}
                        },null,50,50);
                        Emit(new {type="ready"});
                    }));
                    string? line;
                    while((line=await Console.In.ReadLineAsync())!=null) {
                        if(line.Length>16000) continue;
                        var request=JsonSerializer.Deserialize<Request>(line);
                        if(request==null)continue;
                        main.BeginInvoke((Action)(()=>Dispatch(request)));
                    }
                    // The workbox owning the private pipes has closed.
                    Environment.Exit(0);
                } catch(Exception e) {Emit(new {type="fatal",error=e.Message});Environment.Exit(1);}
            });
            // Bootstrap the pinned version without its global singleton mutex or
            // named pipe. A separately installed ShareX keeps its own lifecycle.
            program.GetMethod("StartupWork",Static)!.Invoke(null,null);
            Set("StartTimer",Stopwatch.StartNew());
            var cli=Activator.CreateInstance(assembly.GetType("ShareX.ShareXCLIManager",true)!,new object[]{new[]{"-portable","-multi","-silent"}})!;
            cli.GetType().GetMethod("ParseCommands")!.Invoke(cli,null);Set("CLI",cli);
            assembly.GetType("ShareX.SystemOptions",true)!.GetMethod("UpdateSystemOptions",Static)!.Invoke(null,null);
            program.GetMethod("UpdatePersonalPath",Static)!.Invoke(null,null);
            var debug=Assembly.Load("ShareX.HelpersLib").GetType("ShareX.HelpersLib.DebugHelper",true)!;
            debug.GetMethod("Init",new[]{typeof(string)})!.Invoke(null,new[]{Get("LogsFilePath")});
            Set("MultiInstance",true);
            program.GetMethod("Run",Static)!.Invoke(null,null);
            return 0;
        } catch(Exception e) {Emit(new {type="fatal",error=e.InnerException?.Message??e.Message});return 1;}
    }
    sealed class Request {
        public string? type {get;set;} public string? id {get;set;} public string? mode {get;set;}
        public string? settings {get;set;} public string? input {get;set;}
    }
    static async void Dispatch(Request request) {
        if(request.type=="cancel") {
            if(request.id==job) foreach(Form form in Application.OpenForms.Cast<Form>().ToArray()) if(form!=main && form.Visible) {
                if(form.InvokeRequired)form.BeginInvoke((Action)(()=>form.Close()));else form.Close();
            }
            return;
        }
        if(request.type!="capture" || job!=null || !Guid.TryParse(request.id,out _) || request.settings==null) return;
        job=request.id;executing=true;activeWasVisible=false;quietSince=DateTime.MaxValue;started=Stopwatch.StartNew();
        try {
            // Configuration belongs to this one issued job, including its output
            // directory and receipt. Do not reload or touch personal ShareX data.
            var json=Assembly.Load("Newtonsoft.Json").GetType("Newtonsoft.Json.JsonConvert",true)!;
            var deserialize=json.GetMethod("DeserializeObject",new[]{typeof(string),typeof(Type)})!;
            var configType=program.Assembly.GetType("ShareX.ApplicationConfig",true)!;
            object settings=deserialize.Invoke(null,new object[]{File.ReadAllText(request.settings),configType})!;
            Set("Settings",settings);Set("DefaultTaskSettings",configType.GetField("DefaultTaskSettings")!.GetValue(settings)!);
            string[] arguments=request.mode switch {
                "region"=>new[]{"-RectangleRegion"},"window"=>new[]{"-RectangleLight"},"screen"=>new[]{"-PrintScreen"},
                "edit" when request.input!=null=>new[]{"-ImageEditor",request.input},_=>throw new Exception("无效截图方式")
            };
            await (Task)program.GetMethod("UseCommandLineArgs",Static)!.Invoke(null,new object[]{arguments})!;
        } catch(Exception e) { Emit(new {type="job-error",id=job,error=e.InnerException?.Message??e.Message}); }
        finally {executing=false;}
    }
    static void Observe() {
        if(job==null)return;
        bool visible=Application.OpenForms.Cast<Form>().Any(f=>f!=main && f.Visible);
        if(visible && !activeWasVisible) {activeWasVisible=true;Emit(new {type="visible",id=job,milliseconds=started!.ElapsedMilliseconds});}
        bool busy=(bool)taskManager.GetProperty("IsBusy",Static)!.GetValue(null)!;
        if(executing || visible || busy) {quietSince=DateTime.MaxValue;return;}
        if(quietSince==DateTime.MaxValue) quietSince=DateTime.UtcNow;
        if((DateTime.UtcNow-quietSince).TotalMilliseconds<200)return;
        string completed=job;job=null;Emit(new {type="done",id=completed});
    }
}
