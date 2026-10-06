using System;
using System.IO;
using System.Drawing;
using System.Reflection;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
internal static class ComputerTests {
    static void Check(bool result,string name){if(!result)throw new Exception(name);}
    [STAThread] static void Main(string[] args){try{Run(args);}catch(Exception ex){Console.WriteLine("FAIL: "+ex.GetType().Name+" "+ex.Message);Environment.Exit(1);}}
    static void Run(string[] args){
        Check(ComputerProbe.Cpu(150,240,160,100,200,100)==50,"kernel includes idle; total delta 100 busy 50");
        Check(ComputerProbe.Cpu(1,1,1,2,2,2)==null,"reset CPU counter is unavailable");
        Check(ComputerProbe.Rate(5000,1000,2)==2000,"bytes/sec from elapsed wall time");Check(ComputerProbe.Rate(10,20,1)==null,"network counter reset");
        var processors=new Dictionary<string,double>{{"0,2",12},{"0,10",95},{"1,2",53},{"0,_Total",99},{"_Total",99},{"0,3",150},{"0,4",double.NaN}};
        Check(ComputerProbe.ProcessorUsage(processors,0,2)==12&&ComputerProbe.ProcessorUsage(processors,1,2)==53,"processor groups retain distinct identities");
        Check(ComputerProbe.ProcessorUsage(processors,0,3)==100&&ComputerProbe.ProcessorUsage(processors,0,4)==null&&ComputerProbe.ProcessorUsage(processors,2,0)==null,"clamp load and keep unavailable processors null");
        var engines=new Dictionary<string,double>{{"pid_1_luid_1_phys_0_eng_0_engtype_3D",30},{"pid_2_luid_1_phys_0_eng_0_engtype_3D",40},{"pid_1_luid_1_phys_0_eng_1_engtype_Copy",50}};
        Check(ComputerProbe.Gpu(engines)==70,"aggregate processes per engine, use busiest engine not sum");Check(ComputerProbe.Gpu(new Dictionary<string,double>())==null,"unavailable GPU is not zero");
        var serializer=new JavaScriptSerializer();var snapshot=serializer.Deserialize<Dictionary<string,object>>(@"{""status"":""live"",""sample"":{""cpu"":25,""gpu"":40,""memoryUsed"":16,""memoryTotal"":32,""networks"":[{""name"":""VPN"",""virtual"":true,""receive"":8000000,""send"":20000},{""name"":""Ethernet"",""virtual"":false,""receive"":1000000,""send"":40000}]}}");
        var sample=(Dictionary<string,object>)snapshot["sample"];Check(ComputerOverlay.MemoryPercent(sample)==50,"memory percent");Check(ComputerOverlay.MemoryPercent(new Dictionary<string,object>{{"memoryUsed",null},{"memoryTotal",10}})==null,"null memory preserved");
        Check(Convert.ToString(ComputerOverlay.Network(sample)["name"])=="Ethernet","deserialize native JSON network array and prefer physical adapter");
        using(var owner=new Form())using(var overlay=new ComputerOverlay(()=>{},()=>{})){
            var setting=new ComputerSettings();overlay.Configure(setting,owner);overlay.UpdateSnapshot(snapshot);
            var style=typeof(ComputerOverlay).GetProperty("CreateParams",BindingFlags.NonPublic|BindingFlags.Instance);var compact=(CreateParams)style.GetValue(overlay,null);
            Check((compact.ExStyle&0x08000000)!=0&&(compact.ExStyle&0x20)!=0,"compact does not activate and permits mouse-through");Check(overlay.TopMost&&!overlay.ShowInTaskbar,"always on top and no taskbar tile");
            setting=new ComputerSettings{opacity=1};overlay.Configure(setting,owner);Check(overlay.Opacity<1&&overlay.Opacity>.99,"compact retains layered rendering at maximum opacity");
            using(var image=new Bitmap(overlay.Width,overlay.Height)){overlay.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));image.Save(Path.Combine(args[0],"overlay-compact.png"));}
            setting=new ComputerSettings{mode="mini",anchor="bottom-left",opacity=.65};overlay.Configure(setting,owner);
            var mini=(CreateParams)style.GetValue(overlay,null);Check((mini.ExStyle&0x20)==0,"mini receives drag/context-menu input");Check(Math.Abs(overlay.Opacity-.65)<.01,"opacity applied");Check(overlay.ContextMenuStrip.Items.Count==2,"mini open/hide actions");
            using(var image=new Bitmap(overlay.Width,overlay.Height)){overlay.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));image.Save(Path.Combine(args[0],"overlay-mini.png"));}
        }
        Console.WriteLine("PASS: CPU/GPU/network math, null metrics, JSON/native overlay, window styles, rendering");
    }
}
