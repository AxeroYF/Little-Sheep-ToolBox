using System;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;
class AppFixture:Form {
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr h,string n,IntPtr v);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string n);
    readonly string file;readonly uint close=RegisterWindowMessage("Xiaoyang.Workbox.Exit.v1");readonly Timer timer=new Timer();
    AppFixture(string path){file=path;ShowInTaskbar=false;Opacity=0;SetProp(Handle,"Xiaoyang.Workbox.ManagedExit.v1",new IntPtr(1));Shown+=(s,e)=>{Hide();File.WriteAllText(file,"ready");};FormClosing+=(s,e)=>{if(File.Exists(file+".cancel")){e.Cancel=true;File.Delete(file+".cancel");File.WriteAllText(file,"cancelled");}else File.WriteAllText(file,"closed");};timer.Interval=30000;timer.Tick+=(s,e)=>Close();timer.Start();}
    protected override void WndProc(ref Message m){if((uint)m.Msg==close){Close();return;}base.WndProc(ref m);}
    [STAThread] static void Main(string[] args){Application.Run(new AppFixture(args[0]));}
}
