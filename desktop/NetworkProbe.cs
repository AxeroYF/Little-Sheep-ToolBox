using System;
using System.Net.NetworkInformation;
using System.Threading;
using System.Diagnostics;
using System.Web.Script.Serialization;
using System.Net;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Win32;
class NetworkProbe {
    static string CleanProxy(string value) {
        if(String.IsNullOrEmpty(value))return "";
        return String.Join("; ",value.Split(';').Select(part=>{
            var pair=part.Split(new[]{'='},2);var address=pair.Length==2?pair[1]:pair[0];Uri uri;
            if(!Uri.TryCreate(address.Contains("://")?address:"http://"+address,UriKind.Absolute,out uri))return "已配置";
            return (pair.Length==2?pair[0]+"=":"")+uri.Host+":"+uri.Port;
        }));
    }
    static object LocalInfo() {
        var adapters=new List<object>();var dns=new List<string>();bool? enabled=null;string proxyServer="";bool pac=false;string proxyError=null;
        try {using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings")) {
            if(key!=null){enabled=Convert.ToInt32(key.GetValue("ProxyEnable",0))!=0;proxyServer=CleanProxy(Convert.ToString(key.GetValue("ProxyServer","")));pac=!String.IsNullOrWhiteSpace(Convert.ToString(key.GetValue("AutoConfigURL","")));}
        }}catch{proxyError="无法读取系统代理设置";}
        foreach(var item in NetworkInterface.GetAllNetworkInterfaces().OrderByDescending(n=>n.NetworkInterfaceType==NetworkInterfaceType.Ethernet||n.NetworkInterfaceType==NetworkInterfaceType.Wireless80211))try {
            if(item.OperationalStatus!=OperationalStatus.Up||item.NetworkInterfaceType==NetworkInterfaceType.Loopback)continue;
            var properties=item.GetIPProperties();var addresses=properties.UnicastAddresses.Select(a=>a.Address.ToString()).ToArray();
            if(addresses.Length==0)continue;
            var servers=properties.DnsAddresses.Select(a=>a.ToString()).Distinct().ToArray();dns.AddRange(servers);
            string identity=(item.Name+" "+item.Description).ToLowerInvariant();
            bool suspected=item.NetworkInterfaceType==NetworkInterfaceType.Tunnel||new[]{"tun","tap","wireguard","wintun","clash","mihomo","tailscale","zerotier"}.Any(s=>identity.Contains(s));
            string type=item.NetworkInterfaceType==NetworkInterfaceType.Ethernet?"以太网":item.NetworkInterfaceType==NetworkInterfaceType.Wireless80211?"Wi-Fi":suspected?"虚拟连接":item.NetworkInterfaceType.ToString();
            adapters.Add(new {name=item.Name,description=item.Description,type=type,speedMbps=!suspected&&item.Speed>0?(double?)Math.Round(item.Speed/1000000.0,2):null,addresses=addresses,gateways=properties.GatewayAddresses.Select(g=>g.Address.ToString()).ToArray(),dns=servers,tunnelSuspected=suspected});
        }catch{}
        return new {adapters=adapters,proxy=new {enabled=enabled,server=proxyServer,pacConfigured=pac,error=proxyError},dns=dns.Distinct().ToArray()};
    }
    static object PublicRoute(string provider,bool system) {
        // The caller passes only a provider ID, never an arbitrary URL or command.
        string address=provider=="ipip"?"https://myip.ipip.net/":"https://ipapi.co/json/";
        bool? viaProxy=null;string proxyAddress=null;
        try {
            var target=new Uri(address);var request=(HttpWebRequest)WebRequest.Create(target);
            request.Proxy=system?WebRequest.GetSystemWebProxy():null;
            if(system) {var route=request.Proxy==null?target:request.Proxy.GetProxy(target);viaProxy=route!=null&&route!=target;if(viaProxy==true)proxyAddress=route.Host+":"+route.Port;}else viaProxy=false;
            request.Timeout=6500;request.ReadWriteTimeout=6500;request.AllowAutoRedirect=false;
            request.UserAgent="XiaoyangNetworkTest/0.3";request.Headers["Cache-Control"]="no-cache";
            using(var response=(HttpWebResponse)request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8)) {
                var text=new StringBuilder();var buffer=new char[2048];int size;
                while((size=reader.Read(buffer,0,buffer.Length))>0){text.Append(buffer,0,size);if(text.Length>16384)throw new IOException("Response too large");}
                return new {body=text.ToString(),source=provider,viaProxy=viaProxy,proxyAddress=proxyAddress};
            }
        }catch{return new {source=provider,viaProxy=viaProxy,proxyAddress=proxyAddress,error="查询超时或服务不可用"};}
    }
    static int Main(string[] args) {
        Console.OutputEncoding=new UTF8Encoding(false);
        if(args.Length<1)return 2;
        int parentId;
        if (int.TryParse(Environment.GetEnvironmentVariable("WORKBOX_PROBE_PARENT_PID"), out parentId)) {
            try { var parent = Process.GetProcessById(parentId); var watcher = new Thread(delegate() { try { parent.WaitForExit(); } catch { } Environment.Exit(0); }); watcher.IsBackground = true; watcher.Start(); } catch { return 0; }
        }
        var json = new JavaScriptSerializer();
        if(args[0]=="info"&&args.Length==1){Console.WriteLine(json.Serialize(LocalInfo()));return 0;}
        if(args[0]=="identity"&&args.Length==2&&(args[1]=="ipip"||args[1]=="ipapi")) {
            ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
            var direct=Task.Run(()=>PublicRoute(args[1],false));var system=Task.Run(()=>PublicRoute(args[1],true));
            Task.WaitAll(direct,system);Console.WriteLine(json.Serialize(new {direct=direct.Result,system=system.Result}));return 0;
        }
        if(args.Length!=2||(args[0]!="ping"&&args[0]!="trace"))return 2;
        string host = args[1];
        using(var ping = new Ping()) {
            int max = args[0] == "ping" ? 10 : 20;
            for(int n=1;n<=max;n++) {
                try {
                    var timer = Stopwatch.StartNew();
                    var reply = ping.Send(host, 1000, new byte[32], new PingOptions(args[0] == "trace" ? n : 64, false));
                    timer.Stop();
                    Console.WriteLine(json.Serialize(new { index=n, address=reply.Address == null ? null : reply.Address.ToString(), status=reply.Status.ToString(), ms=reply.Status == IPStatus.Success ? (double?)reply.RoundtripTime : reply.Status == IPStatus.TtlExpired ? Math.Round(timer.Elapsed.TotalMilliseconds,2) : (double?)null }));
                    Console.Out.Flush();
                    if(args[0] == "trace" && reply.Status == IPStatus.Success) break;
                } catch(Exception ex) { Console.WriteLine(json.Serialize(new { index=n, address=(string)null, status="Error", ms=(long?)null, error=ex.GetType().Name })); Console.Out.Flush(); }
                if(args[0] == "ping") Thread.Sleep(200);
            }
        } return 0;
    }
}
