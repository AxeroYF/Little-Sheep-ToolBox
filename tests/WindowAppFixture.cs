using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;

// A hidden launcher survives the user window, like the external Electron client.
class WindowAppFixture : ApplicationContext {
    class QuietForm : Form {
        protected override bool ShowWithoutActivation { get { return true; } }
        public QuietForm() {
            Opacity=0; ShowInTaskbar=true; Text="Workbox lifecycle fixture";
            StartPosition=FormStartPosition.Manual; Location=new Point(-32000,-32000);
        }
    }
    readonly string file;
    readonly Form launcher=new QuietForm();
    readonly Timer timer=new Timer();
    Form window;
    WindowAppFixture(string path) {
        file=path; var handle=launcher.Handle;
        File.WriteAllText(file,"ready");
        timer.Interval=40;
        timer.Tick+=(s,e)=>{
            if(!File.Exists(file+".command"))return;
            string command=File.ReadAllText(file+".command");File.Delete(file+".command");
            if(command=="show") {
                window=new QuietForm();window.FormClosed+=(a,b)=>File.WriteAllText(file,"closed");window.Show();
            }else if(command=="minimize")window.WindowState=FormWindowState.Minimized;
            else if(command=="hide")window.Hide();
            else if(command=="exit") {timer.Stop();launcher.Dispose();if(window!=null)window.Dispose();ExitThread();}
            File.WriteAllText(file,command);
        };
        timer.Start();
    }
    [STAThread] static void Main(string[] args) { Application.Run(new WindowAppFixture(args[0])); }
}
