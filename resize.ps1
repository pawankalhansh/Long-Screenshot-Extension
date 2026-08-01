Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("d:\Projects\Long Screenshot for Chrome\icons\icon128.jpeg")

function Resize-Image($size, $name) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    $graph.DrawImage($img, 0, 0, $size, $size)
    $path = "d:\Projects\Long Screenshot for Chrome\icons\$name"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graph.Dispose()
    $bmp.Dispose()
}

Resize-Image 128 "icon128.png"
Resize-Image 48 "icon48.png"
Resize-Image 16 "icon16.png"
$img.Dispose()
