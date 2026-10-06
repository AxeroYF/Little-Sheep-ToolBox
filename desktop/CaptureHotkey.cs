using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

// Reserve the new binding before releasing the old one. A failed save or
// occupied shortcut leaves the previous registration intact.
internal sealed class CaptureHotkey : IDisposable {
    internal const string Default = "Ctrl+Alt+S";
    readonly IntPtr window;
    readonly Func<IntPtr,int,uint,uint,bool> register;
    readonly Func<IntPtr,int,bool> unregister;
    internal int ActiveId { get; private set; }
    internal string Value { get; private set; }
    [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key);
    [DllImport("user32.dll",SetLastError=true)] static extern bool UnregisterHotKey(IntPtr h,int id);
    internal CaptureHotkey(IntPtr handle) : this(handle,RegisterHotKey,UnregisterHotKey) { }
    internal CaptureHotkey(IntPtr handle,Func<IntPtr,int,uint,uint,bool> add,Func<IntPtr,int,bool> remove) { window=handle;register=add;unregister=remove;Value=Default; }
    internal static bool Parse(string input,out string value,out uint modifiers,out uint key) {
        value=null;modifiers=0;key=0;
        if(string.IsNullOrEmpty(input) || input.Length>50) return false;
        string[] parts=input.Split('+').Select(p=>p.Trim()).ToArray();
        string main=parts[parts.Length-1];string[] mods=parts.Take(parts.Length-1).ToArray();
        if(mods.Distinct().Count()!=mods.Length || mods.Any(p=>p!="Ctrl" && p!="Alt" && p!="Shift")) return false;
        if(Regex.IsMatch(main,"^[A-Z0-9]$")) { if(!mods.Contains("Ctrl") && !mods.Contains("Alt")) return false;key=main[0]; }
        else if(Regex.IsMatch(main,"^F([1-9]|10|11)$")) key=(uint)(0x70+int.Parse(main.Substring(1))-1);
        else if(main=="PrintScreen") key=0x2C;
        else return false;
        if(main=="F4" && mods.Contains("Alt")) return false;
        if(mods.Contains("Alt")) modifiers|=1;
        if(mods.Contains("Ctrl")) modifiers|=2;
        if(mods.Contains("Shift")) modifiers|=4;
        value=string.Join("+",new[]{"Ctrl","Alt","Shift"}.Where(mods.Contains).Concat(new[]{main}));return true;
    }
    internal Reservation Reserve(string input) {
        string value;uint mods,key;
        if(!Parse(input,out value,out mods,out key)) throw new ArgumentException("不支持这个快捷键");
        if(ActiveId!=0 && Value==value) return new Reservation(this,ActiveId,value,false);
        int id=ActiveId==0x581?0x582:0x581;
        if(!register(window,id,mods|0x4000,key)) throw new InvalidOperationException("快捷键已被占用，请换一个组合");
        return new Reservation(this,id,value,true);
    }
    internal bool Apply(string input) { try { using(var pending=Reserve(input)) pending.Commit();return true; } catch {return false;} }
    internal void Suspend() {if(ActiveId!=0) unregister(window,ActiveId);ActiveId=0;}
    public void Dispose() {Suspend();}
    internal sealed class Reservation : IDisposable {
        readonly CaptureHotkey owner;readonly int id;readonly bool acquired;internal readonly string Value;bool committed;
        internal Reservation(CaptureHotkey manager,int handle,string value,bool added) {owner=manager;id=handle;Value=value;acquired=added;}
        internal void Commit() {if(committed)return;if(owner.ActiveId!=0 && owner.ActiveId!=id) owner.unregister(owner.window,owner.ActiveId);owner.ActiveId=id;owner.Value=Value;committed=true;}
        public void Dispose() {if(!committed && acquired) owner.unregister(owner.window,id);}
    }
}
