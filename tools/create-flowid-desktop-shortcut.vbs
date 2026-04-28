Option Explicit

Dim shellObj
Dim desktopPath
Dim shortcutPath
Dim targetPath

Set shellObj = CreateObject("WScript.Shell")
desktopPath = shellObj.SpecialFolders("Desktop")
shortcutPath = desktopPath & "\FlowidDesktop.lnk"
targetPath = "D:\cursor_demo\Flowid\start-flowid-desktop.bat"

Dim shortcut
Set shortcut = shellObj.CreateShortcut(shortcutPath)
shortcut.TargetPath = targetPath
shortcut.WorkingDirectory = "D:\cursor_demo\Flowid"
shortcut.IconLocation = "C:\Windows\System32\SHELL32.dll,2"
shortcut.Description = "启动 Flowid 桌面端（开发）"
shortcut.Save
