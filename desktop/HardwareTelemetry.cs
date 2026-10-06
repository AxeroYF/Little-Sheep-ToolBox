// LibreHardwareMonitor 0.9.6 adapter. Read sensors only; never call controls or install a driver.
using System;
using System.IO;
using System.Collections;
using System.Collections.Generic;
using System.Management;
using System.Reflection;
using System.Threading;

internal sealed class HardwareTelemetry : IDisposable {
    readonly object gate=new object();
    readonly ManualResetEvent stop=new ManualResetEvent(false);
    readonly Thread worker;
    object[] sensors=new object[0];
    Dictionary<string,object> inventory;
    long? sampledAt;
    string status="starting",error;
    internal HardwareTelemetry(){worker=new Thread(Run);worker.IsBackground=true;worker.Name="Workbox hardware sensors";worker.Start();}
    internal void Read(out object[] values,out long? at,out string state,out string problem,out Dictionary<string,object> details){lock(gate){values=sensors;at=sampledAt;state=status;problem=error;details=inventory;}if(at.HasValue&&Now()-at.Value>12000){values=new object[0];state="unavailable";problem="传感器采样超时";}}
    static long Now(){return (long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds;}
    static object Get(object obj,string name){return obj==null?null:obj.GetType().GetProperty(name).GetValue(obj,null);}
    static string Text(object obj,string name){return Convert.ToString(Get(obj,name));}
    static void Call(object obj,string name){obj.GetType().GetMethod(name,Type.EmptyTypes).Invoke(obj,null);}
    static IEnumerable Items(object obj,string name){return Get(obj,name) as IEnumerable??new object[0];}
    static double? Number(object value){if(value==null)return null;double n;return double.TryParse(Convert.ToString(value),out n)&&!double.IsInfinity(n)&&!double.IsNaN(n)?(double?)n:null;}
    static void Visit(object hardware,List<object> values){
        Call(hardware,"Update");
        foreach(object sensor in Items(hardware,"Sensors")){
            if(values.Count>=4096)break;
            string category=Text(hardware,"HardwareType"),type=Text(sensor,"SensorType");double? value=Number(Get(sensor,"Value"));
            // LHM may retain an initial zero when MSR access or an EC probe is absent.
            if(value==0&&((category=="Cpu"&&type=="Power")||(category=="EmbeddedController"&&type=="Temperature")))value=null;
            values.Add(new {id=Text(sensor,"Identifier"),hardwareId=Text(hardware,"Identifier"),hardware=Text(hardware,"Name"),category=category,name=Text(sensor,"Name"),type=type,value=value});
        }
        foreach(object child in Items(hardware,"SubHardware"))Visit(child,values);
    }
    void Run(){object computer=null;try{
        // Baseline metrics run independently, even if WMI or a device is slow.
        var details=Inventory();lock(gate)inventory=details;
        if(stop.WaitOne(0))return;
        string path=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"components","hardware","LibreHardwareMonitorLib.dll");
        if(!File.Exists(path))throw new FileNotFoundException();
        var assembly=Assembly.LoadFrom(path);
        computer=Activator.CreateInstance(assembly.GetType("LibreHardwareMonitor.Hardware.Computer",true));
        foreach(string feature in new[]{"IsCpuEnabled","IsGpuEnabled","IsMemoryEnabled","IsMotherboardEnabled","IsStorageEnabled","IsBatteryEnabled"})computer.GetType().GetProperty(feature).SetValue(computer,true,null);
        Call(computer,"Open");
        do{
            var values=new List<object>();int failures=0;
            foreach(object hardware in Items(computer,"Hardware"))try{Visit(hardware,values);}catch{failures++;}
            lock(gate){sensors=values.ToArray();sampledAt=Now();status=values.Count>0?"live":"unavailable";error=failures>0?"部分设备传感器不可用":values.Count==0?"当前权限或设备未提供传感器":null;}
        }while(!stop.WaitOne(3000));
    }catch(Exception ex){lock(gate){status="unavailable";error=ex is FileNotFoundException?"扩展传感器组件未就绪":"扩展传感器不可用";}}
    finally{if(computer!=null)try{Call(computer,"Close");}catch{}}}
    static List<Dictionary<string,object>> Query(string table,string fields){var rows=new List<Dictionary<string,object>>();try{using(var search=new ManagementObjectSearcher("SELECT "+fields+" FROM "+table)){
        search.Options.Timeout=TimeSpan.FromSeconds(3);
        using(var collection=search.Get())foreach(ManagementObject record in collection)using(record){var row=new Dictionary<string,object>();foreach(string field in fields.Split(','))row[field]=record[field];rows.Add(row);}
    }}catch{}return rows;}
    static string Str(Dictionary<string,object> row,string key){return Convert.ToString(row[key]).Trim();}
    static Dictionary<string,object> Inventory(){var result=new Dictionary<string,object>();
        var cpus=Query("Win32_Processor","NumberOfCores,MaxClockSpeed,L2CacheSize,L3CacheSize");
        if(cpus.Count>0){double cores=0;foreach(var c in cpus)cores+=Number(c["NumberOfCores"])??0;result["cpuDetails"]=new {cores=cores>0?(double?)cores:null,sockets=(double?)cpus.Count,maxMhz=Number(cpus[0]["MaxClockSpeed"]),l2KB=Number(cpus[0]["L2CacheSize"]),l3KB=Number(cpus[0]["L3CacheSize"])};}
        var memory=new List<object>();foreach(var r in Query("Win32_PhysicalMemory","DeviceLocator,Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed"))memory.Add(new{slot=Str(r,"DeviceLocator"),manufacturer=Str(r,"Manufacturer"),part=Str(r,"PartNumber"),capacity=Number(r["Capacity"]),speed=Number(r["Speed"]),configuredSpeed=Number(r["ConfiguredClockSpeed"])});result["memoryModules"]=memory;
        var disks=new List<object>();foreach(var r in Query("Win32_DiskDrive","Index,Model,Size,InterfaceType"))disks.Add(new{index=Convert.ToInt32(r["Index"]),model=Str(r,"Model"),size=Number(r["Size"]),@interface=Str(r,"InterfaceType")});result["physicalDisks"]=disks;
        var gpus=new List<object>();foreach(var r in Query("Win32_VideoController","Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution"))gpus.Add(new{name=Str(r,"Name"),driver=Str(r,"DriverVersion"),resolution=r["CurrentHorizontalResolution"]!=null&&r["CurrentVerticalResolution"]!=null?Str(r,"CurrentHorizontalResolution")+" × "+Str(r,"CurrentVerticalResolution"):""});result["gpuDetails"]=gpus;
        var boards=Query("Win32_BaseBoard","Manufacturer,Product");var bios=Query("Win32_BIOS","SMBIOSBIOSVersion");if(boards.Count>0)result["board"]=new {manufacturer=Str(boards[0],"Manufacturer"),model=Str(boards[0],"Product"),bios=bios.Count>0?Str(bios[0],"SMBIOSBIOSVersion"):""};
        return result;
    }
    public void Dispose(){stop.Set();if(worker.Join(1000))stop.Dispose();}
}
