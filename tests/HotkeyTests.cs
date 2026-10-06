using System;
using System.Collections.Generic;
using System.Windows.Forms;
internal static class HotkeyTests {
    static void Check(bool result,string name) { if(!result)throw new Exception(name); }
    [STAThread] static void Main() {
        string value;uint mods,key;
        Check(CaptureHotkey.Parse("Shift+Ctrl+K",out value,out mods,out key)&&value=="Ctrl+Shift+K"&&mods==6&&key==75,"normalization");
        foreach(string invalid in new[]{"A","Shift+A","Ctrl+Ctrl+A","Alt+F4","F12","Win+S","Ctrl+;",""})Check(!CaptureHotkey.Parse(invalid,out value,out mods,out key),"invalid: "+invalid);
        foreach(string valid in new[]{"Ctrl+Alt+S","Ctrl+Shift+8","Alt+Q","F9","PrintScreen","Alt+PrintScreen"})Check(CaptureHotkey.Parse(valid,out value,out mods,out key),"valid: "+valid);
        var registered=new Dictionary<int,string>();
        using(var host=new CaptureHotkey(IntPtr.Zero,(h,id,m,k)=>{string name=m+":"+k;if(registered.ContainsValue(name)||k==90)return false;registered.Add(id,name);return true;},(h,id)=>registered.Remove(id))) {
            Check(host.Apply("Ctrl+Alt+S"),"initial registration");int oldId=host.ActiveId;
            Check(!host.Apply("Ctrl+Alt+Z")&&host.ActiveId==oldId&&host.Value=="Ctrl+Alt+S","conflict preserves old key");
            using(var proposal=host.Reserve("Ctrl+Shift+K"))Check(registered.Count==2,"reserve holds old binding until saved");
            Check(registered.Count==1&&host.ActiveId==oldId,"failed persistence rolls back candidate");
            using(var proposal=host.Reserve("Ctrl+Shift+K"))proposal.Commit();
            Check(registered.Count==1&&host.Value=="Ctrl+Shift+K","save commits replacement");
            host.Suspend();Check(registered.Count==0,"recording suspends capture");Check(host.Apply(host.Value),"recording cancel restores key");
        }
        Check(registered.Count==0,"dispose releases binding");
        // Real Windows API conflict check on two hidden message windows. No
        // synthetic keyboard input, visible dialogs, or changes to system settings.
        using(var first=new Form())using(var second=new Form())using(var one=new CaptureHotkey(first.Handle))using(var two=new CaptureHotkey(second.Handle)) {
            Check(one.Apply("Ctrl+Alt+Shift+F10"),"native test combination available");
            Check(!two.Apply("Ctrl+Alt+Shift+F10"),"Windows rejects duplicate binding");
            Check(one.Apply("Ctrl+Alt+Shift+F11"),"native replacement");
            Check(two.Apply("Ctrl+Alt+Shift+F10"),"old key released after replacement");
        }
        Console.WriteLine("PASS: parsing, conflict preservation, save rollback, recording, disposal, real Windows registration");
    }
}
