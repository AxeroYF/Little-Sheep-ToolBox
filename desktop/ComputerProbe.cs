// Read-only Windows telemetry. One persistent sampler; no drivers or online services.
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Management;
using System.Net.NetworkInformation;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal sealed class PdhQuery : IDisposable {
    IntPtr query;readonly Dictionary<string,IntPtr> counters=new Dictionary<string,IntPtr>();
    [StructLayout(LayoutKind.Sequential)] struct Value {public uint status;public double value;}
    [StructLayout(LayoutKind.Sequential)] struct Item {public IntPtr name;public Value data;}
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhOpenQuery(string source,IntPtr user,out IntPtr query);
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr query,string path,IntPtr user,out IntPtr counter);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")] static extern uint PdhGetFormattedCounterValue(IntPtr counter,uint format,IntPtr type,out Value value);
    [DllImport("pdh.dll",CharSet=CharSet.Unicode)] static extern uint PdhGetFormattedCounterArray(IntPtr counter,uint format,ref uint bytes,out uint count,IntPtr data);
    [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
    internal PdhQuery(){PdhOpenQuery(null,IntPtr.Zero,out query);}
    internal void Add(string id,string path){IntPtr c;if(query!=IntPtr.Zero&&PdhAddEnglishCounter(query,path,IntPtr.Zero,out c)==0)counters[id]=c;}
    internal void Collect(){if(query!=IntPtr.Zero)PdhCollectQueryData(query);}
    internal double? Read(string id){IntPtr c;Value v;if(!counters.TryGetValue(id,out c)||PdhGetFormattedCounterValue(c,0x200,IntPtr.Zero,out v)!=0||v.status>1||double.IsNaN(v.value)||double.IsInfinity(v.value))return null;return Math.Max(0,v.value);}
    internal Dictionary<string,double> Array(string id){var result=new Dictionary<string,double>();IntPtr c;if(!counters.TryGetValue(id,out c))return result;uint bytes=0,count;
        PdhGetFormattedCounterArray(c,0x200,ref bytes,out count,IntPtr.Zero);if(bytes==0||bytes>8*1024*1024)return result;IntPtr data=Marshal.AllocHGlobal((int)bytes);
        try{if(PdhGetFormattedCounterArray(c,0x200,ref bytes,out count,data)!=0)return result;int size=Marshal.SizeOf(typeof(Item));if((ulong)size*count>bytes)return result;for(int i=0;i<count;i++){var item=(Item)Marshal.PtrToStructure(IntPtr.Add(data,i*size),typeof(Item));if(item.data.status<=1&&!double.IsNaN(item.data.value)&&!double.IsInfinity(item.data.value))result[Marshal.PtrToStringUni(item.name)]=Math.Max(0,item.data.value);}}finally{Marshal.FreeHGlobal(data);}return result;
    }
    public void Dispose(){if(query!=IntPtr.Zero)PdhCloseQuery(query);query=IntPtr.Zero;}
}
internal sealed class NvidiaTelemetry : IDisposable {
    IntPtr library;End shutdown;Device device;Name name;Usage usage;Temperature temperature;Memory memory;uint count;
    [StructLayout(LayoutKind.Sequential)] struct Util {public uint gpu,ram;}
    [StructLayout(LayoutKind.Sequential)] struct Mem {public ulong total,free,used;}
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int End();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Count(out uint count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Device(uint index,out IntPtr handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Name(IntPtr handle,StringBuilder buffer,uint length);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Usage(IntPtr handle,out Util value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Temperature(IntPtr handle,uint sensor,out uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Memory(IntPtr handle,out Mem value);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr lib,string name);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr lib);
    T Get<T>(string symbol) where T:class{IntPtr fn=GetProcAddress(library,symbol);if(fn==IntPtr.Zero)throw new EntryPointNotFoundException();return Marshal.GetDelegateForFunctionPointer(fn,typeof(T)) as T;}
    internal NvidiaTelemetry(){try{string path=Path.Combine(Environment.SystemDirectory,"nvml.dll");if(!File.Exists(path))path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"NVIDIA Corporation","NVSMI","nvml.dll");if(!File.Exists(path))return;library=LoadLibraryEx(path,IntPtr.Zero,0x1000);if(library==IntPtr.Zero)return;if(Get<End>("nvmlInit_v2")()!=0){Dispose();return;}shutdown=Get<End>("nvmlShutdown");Get<Count>("nvmlDeviceGetCount_v2")(out count);count=Math.Min(count,32);device=Get<Device>("nvmlDeviceGetHandleByIndex_v2");name=Get<Name>("nvmlDeviceGetName");usage=Get<Usage>("nvmlDeviceGetUtilizationRates");temperature=Get<Temperature>("nvmlDeviceGetTemperature");memory=Get<Memory>("nvmlDeviceGetMemoryInfo");}catch{Dispose();}}
    internal List<object> Read(){var list=new List<object>();if(library==IntPtr.Zero||device==null)return list;for(uint i=0;i<count;i++){IntPtr h;if(device(i,out h)!=0)continue;var title=new StringBuilder(128);if(name(h,title,128)!=0)title.Append("NVIDIA GPU "+i);Util u;Mem m;uint t;double? load=usage(h,out u)==0?(double?)Math.Min(100,u.gpu):null,temp=temperature(h,0,out t)==0?(double?)t:null;bool hasMemory=memory(h,out m)==0;list.Add(new {name=title.ToString(),usage=load,temperature=temp,memoryUsed=hasMemory?(double?)m.used:null,memoryTotal=hasMemory?(double?)m.total:null});}return list;}
    public void Dispose(){if(shutdown!=null){shutdown();shutdown=null;}if(library!=IntPtr.Zero)FreeLibrary(library);library=IntPtr.Zero;}
}
internal static class ComputerProbe {
    [StructLayout(LayoutKind.Sequential)] sealed class MemoryStatus {public uint length=(uint)Marshal.SizeOf(typeof(MemoryStatus));public uint load;public ulong total,available,totalPage,availablePage,totalVirtual,availableVirtual,extended;}
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx([In,Out] MemoryStatus value);
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out ulong idle,out ulong kernel,out ulong user);
    [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
    [DllImport("kernel32.dll")] static extern uint GetActiveProcessorCount(ushort group);
    [DllImport("kernel32.dll")] static extern ushort GetActiveProcessorGroupCount();
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static volatile bool stopped;
    static string RegistryText(string path,string key,string fallback){try{using(var registry=Registry.LocalMachine.OpenSubKey(path))return Convert.ToString(registry.GetValue(key,fallback));}catch{return fallback;}}
    static Dictionary<string,object> Info(){var gpu=new List<string>();
        string build=RegistryText(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion","CurrentBuildNumber",""),os=RegistryText(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion","ProductName","Windows");int buildNumber;if(int.TryParse(build,out buildNumber)&&buildNumber>=22000)os=os.Replace("Windows 10","Windows 11");
        return new Dictionary<string,object>{{"cpu",RegistryText(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0","ProcessorNameString","CPU").Trim()},{"logicalProcessors",GetActiveProcessorCount(0xffff)},{"os",os+" · "+build},{"gpus",gpu},{"drives",Drives()}};
    }
    static List<object> Drives(){var drives=new List<object>();foreach(var drive in DriveInfo.GetDrives()){try{if(drive.DriveType==DriveType.Fixed&&drive.IsReady)drives.Add(new {name=drive.Name,label=drive.VolumeLabel,format=drive.DriveFormat,total=(double?)drive.TotalSize,free=(double?)drive.AvailableFreeSpace});}catch{}}return drives;}
    internal static double? ProcessorUsage(Dictionary<string,double> values,int group,int index){double value;return values.TryGetValue(group+","+index,out value)&&!double.IsNaN(value)&&!double.IsInfinity(value)?(double?)Math.Max(0,Math.Min(100,value)):null;}
    static List<object> Processors(Dictionary<string,double> values){var result=new List<object>();for(ushort g=0;g<GetActiveProcessorGroupCount();g++)for(int i=0;i<GetActiveProcessorCount(g);i++)result.Add(new{id=g+","+i,group=(int)g,index=i,usage=ProcessorUsage(values,g,i)});return result;}
    static double? Metric(Dictionary<string,double> values,string key){double value;return values.TryGetValue(key,out value)?(double?)value:null;}
    static List<object> Disks(PdhQuery query){Dictionary<string,double> read=query.Array("disk-read"),write=query.Array("disk-write"),idle=query.Array("disk-idle"),queue=query.Array("disk-queue");var result=new List<object>();foreach(string id in read.Keys.Concat(write.Keys).Concat(idle.Keys).Distinct().Where(k=>k!="_Total").OrderBy(k=>k)){double? unused=Metric(idle,id);result.Add(new{id=id,read=Metric(read,id),write=Metric(write,id),active=unused.HasValue?(double?)Math.Max(0,Math.Min(100,100-unused.Value)):null,queue=Metric(queue,id)});}return result;}
    internal static double? Cpu(ulong idle,ulong kernel,ulong user,ulong oldIdle,ulong oldKernel,ulong oldUser){if(idle<oldIdle||kernel<oldKernel||user<oldUser)return null;double total=(double)(kernel-oldKernel)+(user-oldUser);return total<=0?(double?)null:Math.Max(0,Math.Min(100,100*(1-(idle-oldIdle)/total)));}
    internal static double? Rate(long now,long before,double seconds){return now<before||seconds<=0?(double?)null:(now-before)/seconds;}
    internal static double? Gpu(Dictionary<string,double> values){if(values.Count==0)return null;var engines=new Dictionary<string,double>();foreach(var item in values){int at=item.Key.IndexOf("luid_",StringComparison.Ordinal);string key=at<0?item.Key:item.Key.Substring(at);engines[key]=(engines.ContainsKey(key)?engines[key]:0)+item.Value;}return Math.Min(100,engines.Values.Max());}
    static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);int parent=0,limit=0;for(int i=0;i+1<args.Length;i++){if(args[i]=="--parent")int.TryParse(args[++i],out parent);else if(args[i]=="--samples")int.TryParse(args[++i],out limit);}
        var input=new Thread(()=>{try{while(Console.ReadLine()!=null){} }catch{}stopped=true;});input.IsBackground=true;input.Start();
        using(var timer=new System.Threading.Timer(_=>{if(parent>0)try{using(var owner=Process.GetProcessById(parent)){if(owner.HasExited)Environment.Exit(0);}}catch{Environment.Exit(0);}},null,1000,1000))
        using(var query=new PdhQuery())using(var nvidia=new NvidiaTelemetry())using(var hardware=new HardwareTelemetry()){
            try{
                var info=Info();Console.WriteLine(Json.Serialize(new {type="info",data=info}));
                query.Add("read",@"\PhysicalDisk(_Total)\Disk Read Bytes/sec");query.Add("write",@"\PhysicalDisk(_Total)\Disk Write Bytes/sec");query.Add("mhz",@"\Processor Information(_Total)\Processor Frequency");
                query.Add("gpu",@"\GPU Engine(*)\Utilization Percentage");query.Add("gpu-memory",@"\GPU Adapter Memory(*)\Dedicated Usage");
                query.Add("processors",@"\Processor Information(*)\% Processor Time");query.Add("cpu-total",@"\Processor Information(_Total)\% Processor Time");
                query.Add("disk-read",@"\PhysicalDisk(*)\Disk Read Bytes/sec");query.Add("disk-write",@"\PhysicalDisk(*)\Disk Write Bytes/sec");query.Add("disk-idle",@"\PhysicalDisk(*)\% Idle Time");query.Add("disk-queue",@"\PhysicalDisk(*)\Current Disk Queue Length");
                query.Add("commit-used",@"\Memory\Committed Bytes");query.Add("commit-limit",@"\Memory\Commit Limit");
                ulong oldIdle=0,oldKernel=0,oldUser=0;bool hadCpu=GetSystemTimes(out oldIdle,out oldKernel,out oldUser);query.Collect();
                var previous=new Dictionary<string,long[]>();var clock=Stopwatch.StartNew();double last=0;int taken=0;Dictionary<string,object> lastDetails=null;
                while(!stopped&&(limit<=0||taken<limit)){
                    Thread.Sleep(1000);if(stopped)break;double now=clock.Elapsed.TotalSeconds,seconds=now-last;last=now;
                    ulong idle,kernel,user;bool hasCpu=GetSystemTimes(out idle,out kernel,out user);double? cpu=hasCpu&&hadCpu?Cpu(idle,kernel,user,oldIdle,oldKernel,oldUser):null;oldIdle=idle;oldKernel=kernel;oldUser=user;hadCpu=hasCpu;
                    var mem=new MemoryStatus();bool memory=GlobalMemoryStatusEx(mem);query.Collect();
                    var networks=new List<object>();var next=new Dictionary<string,long[]>();foreach(var adapter in NetworkInterface.GetAllNetworkInterfaces()){try{if(adapter.OperationalStatus!=OperationalStatus.Up||adapter.NetworkInterfaceType==NetworkInterfaceType.Loopback)continue;var traffic=adapter.GetIPv4Statistics();long[] old;bool found=previous.TryGetValue(adapter.Id,out old);next[adapter.Id]=new[]{traffic.BytesReceived,traffic.BytesSent};string label=(adapter.Name+" "+adapter.Description).ToLowerInvariant();bool virtualNic=adapter.NetworkInterfaceType==NetworkInterfaceType.Tunnel||new[]{"virtual","vpn","tap","tun","hyper-v","vmware","vethernet","loopback"}.Any(label.Contains);networks.Add(new {id=adapter.Id,name=adapter.Name,description=adapter.Description,@virtual=virtualNic,linkSpeed=adapter.Speed>0?(double?)adapter.Speed:null,addresses=adapter.GetIPProperties().UnicastAddresses.Select(a=>a.Address.ToString()).ToArray(),receivedBytes=(double?)traffic.BytesReceived,sentBytes=(double?)traffic.BytesSent,receive=found?Rate(traffic.BytesReceived,old[0],seconds):null,send=found?Rate(traffic.BytesSent,old[1],seconds):null});}catch{}}previous=next;
                    object[] sensors;long? sensorAt;string sensorStatus,sensorError;Dictionary<string,object> details;hardware.Read(out sensors,out sensorAt,out sensorStatus,out sensorError,out details);
                    if(details!=null&&!object.ReferenceEquals(details,lastDetails)){foreach(var field in details)info[field.Key]=field.Value;lastDetails=details;Console.WriteLine(Json.Serialize(new {type="info",data=info}));}
                    if(taken>0&&taken%30==0){info["drives"]=Drives();Console.WriteLine(Json.Serialize(new {type="info",data=info}));}
                    var gpuMemory=query.Array("gpu-memory");
                    Console.WriteLine(Json.Serialize(new {type="sample",data=new {at=(long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds,cpu=query.Read("cpu-total")??(GetActiveProcessorGroupCount()==1?cpu:null),cpuMhz=query.Read("mhz"),processors=Processors(query.Array("processors")),disks=Disks(query),sensors=sensors,sensorAt=sensorAt,sensorStatus=sensorStatus,sensorError=sensorError,memoryAvailable=memory?(double?)mem.available:null,commitUsed=query.Read("commit-used"),commitLimit=query.Read("commit-limit"),memoryUsed=memory?(double?)(mem.total-mem.available):null,memoryTotal=memory?(double?)mem.total:null,diskRead=query.Read("read"),diskWrite=query.Read("write"),gpu=Gpu(query.Array("gpu")),gpuMemoryUsed=gpuMemory.Count>0?(double?)gpuMemory.Values.Sum():null,networks=networks,gpus=nvidia.Read(),uptimeSeconds=(double?)GetTickCount64()/1000}}));taken++;
                }return 0;
            }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 1;}
        }
    }
}
