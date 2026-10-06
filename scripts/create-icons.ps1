$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskIconRoot=Join-Path $PSScriptRoot '../desktop'
foreach($taskKind in @('workbox','network','room','images','computer','video')) {
 $taskBitmap=New-Object System.Drawing.Bitmap 64,64
 $taskGraphics=[System.Drawing.Graphics]::FromImage($taskBitmap)
 $taskGraphics.SmoothingMode='AntiAlias'
 $taskGraphics.Clear([System.Drawing.Color]::Transparent)
 $taskBlue=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(6,117,249))
 $taskGraphics.FillEllipse($taskBlue,0,0,64,64)
 if($taskKind -eq 'workbox') {
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,10,19,24,24)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,20,10,24,28)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,32,18,22,25)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,17,30,30,18)
  $taskGraphics.FillEllipse($taskBlue,25,27,20,25)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,30,35,3,4)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,38,35,3,4)
 } elseif($taskKind -eq 'room') {
  $taskPen=New-Object System.Drawing.Pen ([System.Drawing.Color]::White),4
  $taskPoints=[System.Drawing.Point[]]@((New-Object System.Drawing.Point 12,29),(New-Object System.Drawing.Point 32,13),(New-Object System.Drawing.Point 52,29),(New-Object System.Drawing.Point 52,51),(New-Object System.Drawing.Point 12,51),(New-Object System.Drawing.Point 12,29))
  $taskGraphics.DrawLines($taskPen,$taskPoints)
  $taskGraphics.DrawRectangle($taskPen,25,34,14,17);$taskPen.Dispose()
 } elseif($taskKind -eq 'images') {
  $taskPen=New-Object System.Drawing.Pen ([System.Drawing.Color]::White),3
  $taskGraphics.DrawRectangle($taskPen,12,16,40,33)
  $taskGraphics.FillEllipse([System.Drawing.Brushes]::White,37,22,7,7)
  $taskPoints=[System.Drawing.Point[]]@((New-Object System.Drawing.Point 15,44),(New-Object System.Drawing.Point 26,29),(New-Object System.Drawing.Point 35,40),(New-Object System.Drawing.Point 41,34),(New-Object System.Drawing.Point 49,44))
  $taskGraphics.DrawLines($taskPen,$taskPoints);$taskPen.Dispose()
 } elseif($taskKind -eq 'video') {
  $taskPoints=[System.Drawing.Point[]]@((New-Object System.Drawing.Point 25,17),(New-Object System.Drawing.Point 48,32),(New-Object System.Drawing.Point 25,47))
  $taskGraphics.FillPolygon([System.Drawing.Brushes]::White,$taskPoints)
 } elseif($taskKind -eq 'computer') {
  $taskPen=New-Object System.Drawing.Pen ([System.Drawing.Color]::White),3
  $taskGraphics.DrawRectangle($taskPen,11,15,42,30)
  $taskGraphics.DrawLine($taskPen,32,45,32,52);$taskGraphics.DrawLine($taskPen,22,52,42,52)
  $taskGraphics.DrawLine($taskPen,18,36,25,27);$taskGraphics.DrawLine($taskPen,25,27,33,36);$taskGraphics.DrawLine($taskPen,33,36,45,23);$taskPen.Dispose()
 } else {
  $taskPen=New-Object System.Drawing.Pen ([System.Drawing.Color]::White),4
  $taskPoints=[System.Drawing.Point[]]@((New-Object System.Drawing.Point 10,34),(New-Object System.Drawing.Point 21,34),(New-Object System.Drawing.Point 27,18),(New-Object System.Drawing.Point 36,46),(New-Object System.Drawing.Point 43,28),(New-Object System.Drawing.Point 54,28))
  $taskGraphics.DrawLines($taskPen,$taskPoints);$taskPen.Dispose()
 }
 $taskGraphics.Dispose();$taskBlue.Dispose()
 $taskMemory=New-Object System.IO.MemoryStream
 $taskBitmap.Save($taskMemory,[System.Drawing.Imaging.ImageFormat]::Png)
 $taskBytes=$taskMemory.ToArray()
 $taskStream=[System.IO.File]::Create((Join-Path $taskIconRoot "$taskKind.ico"))
 $taskWriter=New-Object System.IO.BinaryWriter $taskStream
 $taskWriter.Write([uint16]0);$taskWriter.Write([uint16]1);$taskWriter.Write([uint16]1)
 $taskWriter.Write([byte]64);$taskWriter.Write([byte]64);$taskWriter.Write([byte]0);$taskWriter.Write([byte]0)
 $taskWriter.Write([uint16]1);$taskWriter.Write([uint16]32);$taskWriter.Write([uint32]$taskBytes.Length);$taskWriter.Write([uint32]22);$taskWriter.Write($taskBytes)
 $taskWriter.Dispose();$taskMemory.Dispose();$taskBitmap.Dispose()
}
