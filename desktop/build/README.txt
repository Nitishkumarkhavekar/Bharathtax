Drop your Windows app icon here as:

    icon.ico

It should be a multi-size .ico (256, 128, 64, 48, 32, 16). The scales-of-
justice image the customer provided fits perfectly — convert it once with
either an online PNG->ICO tool, or:

    magick source.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

electron-builder references this path from package.json ("win.icon": "build/icon.ico").
If the file is missing the build will fall back to Electron's default icon.
