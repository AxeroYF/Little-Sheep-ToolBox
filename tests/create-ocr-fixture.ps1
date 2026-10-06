param([Parameter(Mandatory=$true)][string]$Path)
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object System.Drawing.Bitmap 1200,300
$canvas=[System.Drawing.Graphics]::FromImage($bitmap)
$font=New-Object System.Drawing.Font 'Microsoft YaHei UI',36
try {
  $canvas.Clear([System.Drawing.Color]::White)
  $canvas.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $label = -join ([char[]]@(0x5c0f,0x7f8a,0x6587,0x5b57,0x8bc6,0x522b,0x6d4b,0x8bd5))
  $canvas.DrawString($label, $font, [System.Drawing.Brushes]::Black, 35, 35)
  $canvas.DrawString('WORKBOX OCR 2026', $font, [System.Drawing.Brushes]::Black, 35, 140)
  $bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png)
} finally {$font.Dispose();$canvas.Dispose();$bitmap.Dispose()}
