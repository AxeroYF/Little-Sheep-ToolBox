using System;
using System.Drawing;
using System.Globalization;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal sealed class ComputerSettings {
    public string hotkey {get;set;} public string mode {get;set;} public string anchor {get;set;}
    public double opacity {get;set;} public bool closeToTray {get;set;}
    public ComputerSettings(){hotkey="Ctrl+Alt+R";mode="compact";anchor="top-right";opacity=.88;closeToTray=true;}
}
internal sealed class ComputerOverlay : Form {
    ComputerSettings settings=new ComputerSettings();Dictionary<string,object> sample;
    readonly Action dashboard,toggle;string state="正在采样…";float scale=1;
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr handle,int message,IntPtr w,IntPtr l);
    internal ComputerOverlay(Action open,Action hide){dashboard=open;toggle=hide;Text="小羊电脑信息 · 悬浮窗";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;DoubleBuffered=true;StartPosition=FormStartPosition.Manual;BackColor=Color.FromArgb(23,26,31);ForeColor=Color.White;
        var menu=new ContextMenuStrip();menu.Items.Add("打开仪表盘",null,(s,e)=>dashboard());menu.Items.Add("隐藏悬浮窗",null,(s,e)=>toggle());ContextMenuStrip=menu;
        MouseDown+=(s,e)=>{if(settings.mode=="mini"&&e.Button==MouseButtons.Left){ReleaseCapture();SendMessage(Handle,0xA1,(IntPtr)2,IntPtr.Zero);}};
        DoubleClick+=(s,e)=>dashboard();FormClosed+=(s,e)=>menu.Dispose();
    }
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000080; if(settings.mode=="compact")p.ExStyle|=0x00000020;return p;}}
    internal void Configure(ComputerSettings value,Form owner){bool changed=settings.mode!=value.mode;settings=value;scale=owner.DeviceDpi/96f;Size=new Size((int)((value.mode=="mini"?304:480)*scale),(int)((value.mode=="mini"?194:46)*scale));// Keep the layered window style even at the 100% setting so compact mode stays mouse-through.
        Opacity=value.mode=="compact"&&value.opacity>=1?.999:value.opacity;
        Rectangle area=Screen.FromControl(owner).WorkingArea;int gap=(int)(18*scale);Location=new Point(value.anchor.EndsWith("right")?area.Right-Width-gap:area.Left+gap,value.anchor.StartsWith("bottom")?area.Bottom-Height-gap:area.Top+gap);if(changed&&IsHandleCreated)RecreateHandle();Invalidate();
    }
    internal void UpdateSnapshot(Dictionary<string,object> snapshot){object data,status;sample=snapshot.TryGetValue("sample",out data)?data as Dictionary<string,object>:null;string value=snapshot.TryGetValue("status",out status)?status as string:null;state=value=="unavailable"?"采样不可用":sample==null?"正在采样…":"实时 · 1 秒";if(value=="unavailable")sample=null;Invalidate();}
    internal static double? Number(Dictionary<string,object> data,string key){object value;if(data==null||!data.TryGetValue(key,out value)||value==null)return null;try{return Convert.ToDouble(value,CultureInfo.InvariantCulture);}catch{return null;}}
    static string Percent(double? value){return value.HasValue?value.Value.ToString("0",CultureInfo.InvariantCulture)+"%":"—";}
    static string Rate(double? value){return !value.HasValue?"—":value>=1048576?(value.Value/1048576).ToString("0.0")+" MB/s":(value.Value/1024).ToString("0")+" KB/s";}
    internal static double? MemoryPercent(Dictionary<string,object> data){double? used=Number(data,"memoryUsed"),total=Number(data,"memoryTotal");return used.HasValue&&total>0?100*used/total:null;}
    internal static Dictionary<string,object> Network(Dictionary<string,object> data){object rows;if(data==null||!data.TryGetValue("networks",out rows))return null;var values=rows as System.Collections.IEnumerable;if(values==null)return null;Dictionary<string,object> best=null;double score=-1;foreach(var value in values){var row=value as Dictionary<string,object>;if(row==null)continue;object v;bool virtualNic=row.TryGetValue("virtual",out v)&&v is bool&&(bool)v;double weight=(Number(row,"receive")??0)+(Number(row,"send")??0)+(virtualNic?0:1e15);if(weight>score){best=row;score=weight;}}return best;}
    protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);e.Graphics.ScaleTransform(scale,scale);e.Graphics.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;var network=Network(sample);string cpu=Percent(Number(sample,"cpu")),gpu=Percent(Number(sample,"gpu")),ram=Percent(MemoryPercent(sample)),down=Rate(Number(network,"receive")),up=Rate(Number(network,"send"));
        using(var title=new Font("Segoe UI",9,FontStyle.Bold))using(var regular=new Font("Segoe UI",9))using(var muted=new SolidBrush(Color.FromArgb(159,172,190)))using(var blue=new SolidBrush(Color.FromArgb(64,157,255))){
            if(settings.mode=="compact"){
                e.Graphics.FillRectangle(blue,0,0,3,46);e.Graphics.DrawString("CPU "+cpu+"    GPU "+gpu+"    RAM "+ram,title,Brushes.White,13,6);e.Graphics.DrawString(sample==null?state:"↓ "+down+"     ↑ "+up,regular,muted,13,26);
            }else{
                e.Graphics.DrawString("小羊电脑信息",title,Brushes.White,16,13);e.Graphics.DrawString(state,regular,muted,188,13);
                string[] labels={"CPU","GPU","内存","网络 ↓","网络 ↑"},values={cpu,gpu,ram,down,up};double?[] bars={Number(sample,"cpu"),Number(sample,"gpu"),MemoryPercent(sample)};
                for(int i=0;i<labels.Length;i++){float y=43+i*27;e.Graphics.DrawString(labels[i],regular,muted,16,y);e.Graphics.DrawString(values[i],title,Brushes.White,207,y);if(i<3){e.Graphics.FillRectangle(Brushes.DimGray,69,y+7,121,3);if(bars[i].HasValue)e.Graphics.FillRectangle(blue,69,y+7,(float)Math.Max(0,Math.Min(100,bars[i].Value))*1.21f,3);}}
            }
        }
    }
}
