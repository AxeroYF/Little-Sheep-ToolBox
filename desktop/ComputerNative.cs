using System;
using System.Net;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal partial class WorkboxWindow {
    ComputerOverlay computerOverlay;ComputerSettings computerSettings=new ComputerSettings();
    System.Windows.Forms.Timer computerTimer;bool computerPolling,computerRecording,computerSaving,computerAvailable;int computerGeneration;
    void InitComputer(){
        computerOverlay=new ComputerOverlay(Restore,ToggleComputerOverlay);computerTimer=new System.Windows.Forms.Timer();computerTimer.Interval=1000;computerTimer.Tick+=async(s,e)=>await PollComputerOverlay();
        tray.Icon=Icon;tray.Text="小羊电脑信息";var menu=new ContextMenuStrip();menu.Items.Add("打开仪表盘",null,(s,e)=>Restore());menu.Items.Add("显示 / 隐藏悬浮窗",null,(s,e)=>ToggleComputerOverlay());menu.Items.Add("退出",null,(s,e)=>{exiting=true;Close();});tray.ContextMenuStrip=menu;tray.DoubleClick+=(s,e)=>Restore();tray.Visible=true;
        Resize+=(s,e)=>ComputerVisibility();VisibleChanged+=(s,e)=>ComputerVisibility();
        Deactivate+=(s,e)=>{if(computerRecording&&!computerSaving){computerRecording=false;computerAvailable=hotkeys.Apply(computerSettings.hotkey);Post(new {type="computer-recording-cancelled"});ComputerState();}};
    }
    void ComputerVisibility(){if(computer)Post(new {type="computer-visibility",visible=Visible&&WindowState!=FormWindowState.Minimized});}
    void ComputerState(){Post(new {type="computer-state",visible=computerOverlay.Visible,available=computerAvailable,settings=computerSettings});}
    async Task ComputerSession(bool active){int generation=++computerGeneration;computerRecording=false;
        if(!active){hotkeys.Suspend();computerOverlay.Hide();computerTimer.Stop();computerAvailable=false;return;}
        try{using(var client=await NativeClient()){var text=await client.DownloadStringTaskAsync(origin+"/api/computer/settings");if(generation!=computerGeneration||!signedIn||IsDisposed)return;computerSettings=new JavaScriptSerializer().Deserialize<ComputerSettings>(text);computerOverlay.Configure(computerSettings,this);computerAvailable=hotkeys.Apply(computerSettings.hotkey);computerTimer.Start();ComputerState();ComputerVisibility();}}catch{if(generation==computerGeneration){computerAvailable=false;ComputerState();}}
    }
    void ToggleComputerOverlay(){if(!computer||!signedIn||computerRecording||computerSaving)return;if(computerOverlay.Visible)computerOverlay.Hide();else{computerOverlay.Configure(computerSettings,this);computerOverlay.Show();var ignored=PollComputerOverlay();}ComputerState();}
    async Task PollComputerOverlay(){if(!signedIn||computerPolling||!computerOverlay.Visible||IsDisposed)return;computerPolling=true;
        try{using(var client=await NativeClient()){string data=await client.DownloadStringTaskAsync(origin+"/api/computer/snapshot");if(!IsDisposed&&signedIn)computerOverlay.UpdateSnapshot(new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(data));}}
        catch(WebException ex){var response=ex.Response as HttpWebResponse;if(response!=null&&response.StatusCode==HttpStatusCode.Unauthorized){computerOverlay.Hide();hotkeys.Suspend();computerAvailable=false;ComputerState();}else if(!IsDisposed)computerOverlay.UpdateSnapshot(new Dictionary<string,object>{{"status","unavailable"}});}
        catch{if(!IsDisposed)computerOverlay.UpdateSnapshot(new Dictionary<string,object>{{"status","unavailable"}});}
        finally{computerPolling=false;}
    }
    async Task ComputerMessage(string action,Dictionary<string,object> message){
        if(action=="computer-sync"){ComputerState();ComputerVisibility();return;}
        if(action=="computer-toggle"){ToggleComputerOverlay();return;}
        if(action=="computer-recording"&&!computerSaving){computerRecording=message.ContainsKey("active")&&message["active"] is bool&&(bool)message["active"];if(computerRecording)hotkeys.Suspend();else computerAvailable=hotkeys.Apply(computerSettings.hotkey);ComputerState();return;}
        if(action!="computer-save"||computerSaving||!message.ContainsKey("settings"))return;
        computerSaving=true;string requestId=message.ContainsKey("requestId")?message["requestId"] as string:null;
        try{
            var serializer=new JavaScriptSerializer();var next=serializer.Deserialize<ComputerSettings>(serializer.Serialize(message["settings"]));
            // Reserve candidate first; failed persistence releases it and restores the old binding.
            using(var pending=hotkeys.Reserve(next.hotkey))using(var client=await NativeClient()){
                client.Headers["Origin"]=origin;client.Headers["Content-Type"]="application/json";client.Headers["X-Workbox-Native-Files"]=nativeFilesToken;
                string result=await client.UploadStringTaskAsync(origin+"/api/computer/settings","PUT",serializer.Serialize(next));if(!signedIn)throw new InvalidOperationException("请重新登录");pending.Commit();computerSettings=serializer.Deserialize<ComputerSettings>(result);computerAvailable=true;computerRecording=false;computerOverlay.Configure(computerSettings,this);
            }
            Post(new {type="computer-saved",requestId=requestId,settings=computerSettings});ComputerState();
        }catch(Exception ex){computerRecording=false;if(signedIn)computerAvailable=hotkeys.Apply(computerSettings.hotkey);Post(new {type="computer-saved",requestId=requestId,error=ex is WebException?"保存失败，请重新打开电脑信息后重试":ex.Message});ComputerState();}
        finally{computerSaving=false;}
    }
    void DisposeComputer(){if(computerTimer!=null){computerTimer.Stop();computerTimer.Dispose();}if(computerOverlay!=null)computerOverlay.Dispose();}
}
