using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

class VideoHostSmoke {
    [STAThread] static int Main(string[] args){
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);int result=1;
        using(var form=new WorkboxWindow("Video integration test",false,args[0],false,false,false,true)){
            form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new System.Drawing.Point(-30000,-30000);
            form.Shown+=async delegate{try{await form.TestVideoHost(args[1]);result=0;}catch(Exception ex){File.WriteAllText(Path.Combine(args[0],"host-failure.txt"),ex.ToString());}finally{form.Close();}};
            Application.Run(form);
        }return result;
    }
}
internal partial class WorkboxWindow {
    async Task HostWait(Func<bool> condition,string name){var end=DateTime.UtcNow.AddSeconds(25);while(DateTime.UtcNow<end){if(condition()){File.AppendAllText(Path.Combine(dataDir,"host-tests.txt"),"PASS "+name+Environment.NewLine);return;}await Task.Delay(100);}throw new Exception(name+"; "+videoError+"; "+status.Text);}
    async Task HostJsWait(string expression,string name){var end=DateTime.UtcNow.AddSeconds(20);while(DateTime.UtcNow<end){if(await view.CoreWebView2.ExecuteScriptAsync(expression)=="true"){File.AppendAllText(Path.Combine(dataDir,"host-tests.txt"),"PASS "+name+Environment.NewLine);return;}await Task.Delay(100);}throw new Exception(name);}
    Task HostCommand(string action,object payload=null){var json=new JavaScriptSerializer();return view.CoreWebView2.ExecuteScriptAsync("window.chrome.webview.postMessage(Object.assign("+json.Serialize(new{action="video-"+action,requestId=Guid.NewGuid().ToString()})+","+json.Serialize(payload??new{})+"))");}
    internal async Task TestVideoHost(string source){
        view.CoreWebView2InitializationCompleted+=(s,e)=>File.AppendAllText(Path.Combine(dataDir,"webview-init.txt"),e.IsSuccess+" "+e.InitializationException+Environment.NewLine);
        await HostWait(()=>view.CoreWebView2!=null&&view.Source!=null&&view.Source.AbsoluteUri.StartsWith(origin+"/"),"real WebView2 initialized");
        await HostJsWait("!!document.querySelector('input[type=password]')","login page before native library access");
        if(videoCore!=null||videoLibrary!=null)throw new Exception("engine loaded before login");
        await view.CoreWebView2.ExecuteScriptAsync("(async()=>{await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'小羊',password:'Workbox-Local-Dev-2026!'})});location.reload();})()");
        await HostWait(()=>signedIn&&videoLibrary!=null&&!videoBusy,"authenticated native bridge init");
        await HostCommand("link",new {url=source,name="Native integration clip",cacheMs=500});
        await HostWait(()=>!videoBusy&&videoLibrary.items.Count==1,"network source stored through real message bridge");
        await HostCommand("play",new {id=videoLibrary.items[0].id});
        await HostWait(()=>videoLast!=null&&videoLast.state=="playing"&&videoLast.time>300,"native HWND video playback");
        await HostWait(()=>videoSurface.Visible&&videoSurface.Width>200&&ClientRectangle.Contains(videoSurface.Bounds),"DPI video rectangle within client");
        await view.CoreWebView2.ExecuteScriptAsync("[...document.querySelectorAll('button')].find(b=>b.textContent==='连接服务器').click()");
        await HostWait(()=>!videoSurface.Visible,"HTML dialog hides native video surface");
        await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[aria-label=关闭弹窗]').click()");
        await HostWait(()=>videoSurface.Visible,"closing dialog restores native video surface");
        await HostCommand("capture");await HostWait(()=>!videoBusy&&Directory.GetFiles(Path.Combine(dataDir,"screenshots","originals"),"*.png").Length==1,"native screenshot imported into gallery");
        if(Directory.GetFiles(Path.Combine(dataDir,"video","frames")).Length!=0)throw new Exception("temporary frame not cleaned");
        await HostCommand("pause",new {paused=true});await HostWait(()=>videoLast.state=="paused","native pause");
        await HostCommand("fullscreen");await HostWait(()=>videoFull,"native fullscreen");await HostCommand("fullscreen");await HostWait(()=>!videoFull,"native fullscreen restore");
        await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('[aria-label=退出登录]').click()");
        await HostWait(()=>!signedIn&&videoCore==null&&videoLibrary==null&&!videoSurface.Visible,"logout releases engine and account data");
        File.WriteAllText(Path.Combine(dataDir,"host-passed.txt"),"Real WebView2 / WinForms / LibVLC / gallery / logout passed");
    }
}
