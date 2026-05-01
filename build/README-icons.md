## Flowid 桌面端图标如何替换

**唯一源文件（请自己维护，脚本不会覆盖）：**

- **`build/icon.png`** — 建议 **512×512**、接近正方形的 PNG（任务栏上那种橙 F + 黑底等，都以这张图为准）。

**由 `npm run gen:icon` 自动生成（不要手改，会被覆盖）：**

- `build/icon.ico` — 供 `electron-builder` 打 `Flowid.exe`、安装器、卸载程序图标（多尺寸 16/32/48/256）。
- `electron/assets/icon.png` — 开发/运行时窗口左上角等。
- `public/flowid-mark.png` — 网页 favicon、应用内顶栏 `FlowidMark` 与 `index.html` 引用，与 `build/icon.png` 一致。

若缺少 `build/icon.png`，运行 `gen:icon` 会报错并提示先放入该文件。

打包命令：

```powershell
Set-Location D:\flowid\FLOWID
npm run gen:icon
npm run desktop:build
```
