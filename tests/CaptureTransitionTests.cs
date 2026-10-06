using System;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

// Isolated native regression fixture. Only its own test windows are controlled;
// screen images are produced by the actual ShareX API in the companion test.
internal static class CaptureTransitionTests {
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    static readonly Color Marker = Color.FromArgb(239, 31, 163);
    [STAThread] static int Main(string[] args) {
        if (args.Length == 1) {
            using (var image = new Bitmap(args[0])) {
                int marker = 0;
                for (int y = 0; y < image.Height; y += 2)
                    for (int x = 0; x < image.Width; x += 2) {
                        Color color = image.GetPixel(x,y);
                        if (Math.Abs(color.R-Marker.R)<3 && Math.Abs(color.G-Marker.G)<3 && Math.Abs(color.B-Marker.B)<3) marker++;
                    }
                Console.WriteLine(marker);
            }
            return 0;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var background = new Form { Text="截图折叠回归测试", BackColor=Color.FromArgb(17,34,51), FormBorderStyle=FormBorderStyle.None, WindowState=FormWindowState.Maximized, TopMost=true })
        using (var subject = new Form { Text="截图窗口测试", BackColor=Marker, Size=new Size(900,660), StartPosition=FormStartPosition.CenterScreen, TopMost=true }) {
            background.Shown += delegate {
                subject.Show(background);
                Task.Run(async delegate {
                    string line;
                    while ((line = await Console.In.ReadLineAsync()) != null) {
                        string command = line;
                        var done = new TaskCompletionSource<bool>();
                        background.BeginInvoke((Action)(async delegate {
                            try {
                                var clock = Stopwatch.StartNew();
                                if (command == "prepare") await CaptureWindowTransition.PrepareAsync(subject);
                                else if (command == "hidden") subject.Hide();
                                else if (command == "exit") {background.Close();return;}
                                else {
                                    subject.Show();
                                    subject.WindowState = command == "maximized" ? FormWindowState.Maximized : FormWindowState.Normal;
                                    subject.Activate();
                                    // Baseline only: allow the ordinary restore animation to finish.
                                    await Task.Delay(350);
                                    DwmFlush();
                                }
                                int cloaked;
                                DwmGetWindowAttribute(subject.Handle,14,out cloaked,sizeof(int));
                                Console.WriteLine("{\"command\":\""+command+"\",\"ms\":"+clock.ElapsedMilliseconds+",\"state\":\""+subject.WindowState+"\",\"visible\":"+subject.Visible.ToString().ToLowerInvariant()+",\"cloaked\":"+cloaked+"}");
                                Console.Out.Flush();
                            } catch (Exception error) {Console.WriteLine("{\"error\":\""+error.GetType().Name+"\"}");Console.Out.Flush();}
                            finally {done.TrySetResult(true);}
                        }));
                        await done.Task;
                        if(command=="exit")return;
                    }
                    background.BeginInvoke((Action)(()=>background.Close()));
                });
                Console.WriteLine("{\"ready\":true}");Console.Out.Flush();
            };
            Application.Run(background);
        }
        return 0;
    }
}
