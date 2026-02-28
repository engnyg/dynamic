"use strict";
const { app, BrowserWindow, screen, ipcMain, shell, Tray, Menu, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("fs");

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.disableHardwareAcceleration();
}
let tray = null;
let mainWindow = null;

const https = require('https');
const http = require('http');
const { exec } = require('child_process');

// --- Music Search Module ---
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function searchItunes(keyword) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&media=music&limit=5`;
  const result = await httpRequest(url);
  if (!result?.results?.length) return null;
  return result.results.map(s => ({
    name: s.trackName || '',
    artist: s.artistName || '',
    album: s.collectionName || '',
    artwork_url: (s.artworkUrl100 || '').replace('100x100', '600x600'),
    duration: s.trackTimeMillis || 0
  }));
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const bigrams = (str) => {
    const m = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const p = str.substring(i, i + 2);
      m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  };
  const aB = bigrams(a), bB = bigrams(b);
  let inter = 0;
  for (const [p, c] of aB) { if (bB.has(p)) inter += Math.min(c, bB.get(p)); }
  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * inter) / total;
}

function findBestMatch(candidates, targetName, targetArtist) {
  if (!candidates || candidates.length === 0) return null;
  let bestScore = -1, bestMatch = null;
  for (const c of candidates) {
    const score = stringSimilarity(c.name, targetName) * 0.6 + stringSimilarity(c.artist, targetArtist) * 0.4;
    if (score > bestScore) { bestScore = score; bestMatch = c; }
  }
  return bestScore >= 0.2 ? bestMatch : null;
}

const musicInfoCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function getCachedMusicInfo(key) {
  const entry = musicInfoCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) { musicInfoCache.delete(key); return undefined; }
  return entry.data;
}

function setCachedMusicInfo(key, data) {
  if (musicInfoCache.size > 200) musicInfoCache.delete(musicInfoCache.keys().next().value);
  musicInfoCache.set(key, { data, ts: Date.now() });
}

async function searchMusicInfo(title, artist) {
  if (!title) return null;
  const cacheKey = `${title}||${artist || ''}`.toLowerCase();
  const cached = getCachedMusicInfo(cacheKey);
  if (cached !== undefined) return cached;

  const keyword = artist ? `${title} ${artist}` : title;
  let result = null;
  try {
    const candidates = await searchItunes(keyword);
    result = findBestMatch(candidates, title, artist);
  } catch (e) { /* search failed */ }

  setCachedMusicInfo(cacheKey, result);
  return result;
}

ipcMain.handle('set-ignore-mouse-events', (event, ignore, forward) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: forward || false });
  }
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('launch-app', async (event, appName) => {
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open -a "${appName}"`);
  } else if (platform === 'win32') {
    const safeName = appName.replace(/'/g, "''");
    const psScript = [
      `$name = '${safeName}'`,
      `$shell = New-Object -ComObject Shell.Application`,
      `$apps = $shell.NameSpace('shell:AppsFolder').Items()`,
      `$match = $apps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1`,
      `if ($match) { Start-Process "explorer.exe" "shell:AppsFolder\\$($match.Path)" }`,
      `else { Start-Process "$name" }`
    ].join('\n');
    const tmpFile = path.join(app.getPath('temp'), 'ripple-launch.ps1');
    fs.writeFileSync(tmpFile, psScript, 'utf8');
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true });
  } else {
    exec(appName);
  }
});

ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  return displays.map(d => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds
  }));
});

ipcMain.handle('set-display', (event, displayId) => {
  if (mainWindow) {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find(d => d.id.toString() === displayId.toString()) || screen.getPrimaryDisplay();

    const { x, y, width, height } = targetDisplay.bounds;
    const isLinux = process.platform === 'linux';

    mainWindow.setBounds({ x, y, width, height });
    if (!isLinux) {
      mainWindow.setFullScreen(true);
    }

    mainWindow.show();
  }
});

ipcMain.handle('update-window-position', (event, xPerc, yPx) => {
  // Logic handled by React state when window is full screen
});

ipcMain.handle('get-auto-start', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle('set-auto-start', (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  return enabled;
});

ipcMain.handle('set-always-on-top-level', (event, level) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true, level);
  }
});

const getIconPath = () => {
  const ext = 'png';
  if (app.isPackaged) {
    const resPath = path.join(process.resourcesPath, `icon.${ext}`);
    const assetsPath = path.join(process.resourcesPath, `assets/icons/icon.${ext}`);

    if (fs.existsSync(resPath)) return resPath;
    if (fs.existsSync(assetsPath)) return assetsPath;

    return resPath;
  }
  return path.join(__dirname, `../../src/assets/icons/icon.${ext}`);
};

const createWindow = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  const isLinux = process.platform === 'linux';
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const winWidth = width;
  const winHeight = height;
  const winX = x;
  const winY = y;

  // 'type' option is only supported on macOS ('toolbar') and Linux ('dock'); not Windows
  const windowType = isWindows ? undefined : 'toolbar';

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: winX,
    y: winY,
    backgroundColor: "#00000000",
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    frame: false,
    // thickFrame: false breaks transparent windows on Windows
    ...(isWindows ? {} : { thickFrame: false }),
    hasShadow: false,
    skipTaskbar: true,
    icon: getIconPath(),
    // hiddenInMissionControl is a macOS-only option
    ...(isMac ? { hiddenInMissionControl: true } : {}),
    // type is not supported on Windows
    ...(windowType ? { type: windowType } : {}),
    fullscreen: false,
    visibleOnFullScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      devTools: false
    },
    show: false
  });

  if (!isLinux) {
    mainWindow.setFullScreen(true);
  }

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  const showDelay = isLinux ? 500 : 0;

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.focus();
      }
    }, showDelay);
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 5000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Aggressively re-assert topmost on Windows for fullscreen apps
  if (isWindows) {
    let topmostLevel = 'screen-saver';
    let topmostInterval = null;

    const reAssertTopmost = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setAlwaysOnTop(true, topmostLevel);
      }
    };

    mainWindow.on('blur', () => {
      setTimeout(reAssertTopmost, 100);
    });

    topmostInterval = setInterval(reAssertTopmost, 3000);

    mainWindow.on('closed', () => {
      if (topmostInterval) clearInterval(topmostInterval);
    });

    ipcMain.removeHandler('set-always-on-top-level');
    ipcMain.handle('set-always-on-top-level', (event, level) => {
      topmostLevel = level;
      if (level === 'floating') {
        if (topmostInterval) { clearInterval(topmostInterval); topmostInterval = null; }
        if (mainWindow) mainWindow.setAlwaysOnTop(true, 'floating');
      } else {
        reAssertTopmost();
        if (!topmostInterval) topmostInterval = setInterval(reAssertTopmost, 3000);
      }
    });
  }

  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) {
  }

  if (!app.isPackaged || process.env.NODE_ENV === 'development') {
    mainWindow.loadURL("http://localhost:5173").catch(e => {
      console.error('Failed to load dev server:', e);
    });
  } else {
    const rendererPath = path.join(process.resourcesPath, "renderer/main_window/index.html");
    mainWindow.loadFile(rendererPath);
  }
};

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.hide();
  }
  createWindow();

  // Auto updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  // Check every 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 30 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  try {
    const iconPath = getIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    // Always resize specifically for the tray to ensure it fits the OS requirements (usually 16x16 or 32x32)
    const trayIcon = icon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show/Hide Ripple',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isVisible()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);
    tray.setToolTip('Ripple');
    tray.setContextMenu(contextMenu);
  } catch (e) {
    console.error('Failed to create tray:', e);
  }
});

//Keep in mind that this part was made by AI



ipcMain.handle('get-system-media', async () => {
  const basicInfo = await getBasicMediaInfo();
  if (!basicInfo) return null;
  if (basicInfo.artwork_url) return basicInfo;

  try {
    const enriched = await searchMusicInfo(basicInfo.name, basicInfo.artist);
    if (enriched) {
      return {
        ...basicInfo,
        artwork_url: enriched.artwork_url || null,
        album: enriched.album || basicInfo.album || '',
        duration: enriched.duration || 0
      };
    }
  } catch (e) { /* enrichment failed, return basic */ }
  return basicInfo;
});

function getBasicMediaInfo() {
  return new Promise((resolve) => {
    const platform = process.platform;

    if (platform === 'darwin') {
      const script = `
            tell application "System Events"
                set spotifyRunning to (name of every process) contains "Spotify"
                set musicRunning to (name of every process) contains "Music"
            end tell
            if spotifyRunning then
                try
                    tell application "Spotify"
                        set mediaState to player state as string
                        set songName to name of current track
                        set artistName to artist of current track
                        set albumName to album of current track
                        try
                            set artUrl to artwork url of current track
                        on error
                            set artUrl to ""
                        end try
                    end tell
                    return "Spotify" & "||" & mediaState & "||" & songName & "||" & artistName & "||" & albumName & "||" & artUrl
                on error
                    return "Error"
                end try
            else if musicRunning then
                try
                    tell application "Music"
                        set mediaState to player state as string
                        set songName to name of current track
                        set artistName to artist of current track
                        set albumName to album of current track
                    end tell
                    return "Music" & "||" & mediaState & "||" & songName & "||" & artistName & "||" & albumName & "||" & ""
                on error
                    return "Error"
                end try
            else
                return "None"
            end if
            `;
      exec(`osascript -e '${script}'`, (error, stdout) => {
        if (error) {
          return resolve(null);
        }
        const output = stdout.trim();

        if (!output || output === "None" || output === "Error") return resolve(null);

        const parts = output.split('||');
        if (parts.length >= 4) {
          resolve({
            name: parts[2],
            artist: parts[3],
            album: parts[4],
            artwork_url: parts[5] || null,
            state: parts[1] === 'playing' ? 'playing' : 'paused',
            source: parts[0]
          });
        } else {
          resolve(null);
        }
      });

    } else if (platform === 'win32') {
      const psScript = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
Function Await($WinRtTask,$ResultType){$asTask=$asTaskGeneric.MakeGenericMethod($ResultType);$netTask=$asTask.Invoke($null,@($WinRtTask));$netTask.Wait(-1)|Out-Null;$netTask.Result}
$asStream=([System.IO.WindowsRuntimeStreamExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1})[0]
$manager=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session=$manager.GetCurrentSession()
if($session){
$props=Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$playback=$session.GetPlaybackInfo()
$thumbB64=""
try{
  if($props.Thumbnail){
    $stream=Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $netStream=$asStream.Invoke($null,@($stream))
    $memStream=New-Object System.IO.MemoryStream
    $netStream.CopyTo($memStream)
    $bytes=$memStream.ToArray()
    if($bytes.Length -gt 0){$thumbB64=[Convert]::ToBase64String($bytes)}
    $memStream.Dispose()
    $netStream.Dispose()
  }
}catch{}
@{Title=$props.Title;Artist=$props.Artist;Album=$props.AlbumTitle;Status=$playback.PlaybackStatus.ToString().ToLower();Source=$session.SourceAppId;Thumb=$thumbB64}|ConvertTo-Json
}else{"null"}
`;
      const tmpFile = path.join(app.getPath('temp'), 'ripple-media.ps1');
      fs.writeFileSync(tmpFile, psScript, 'utf-8');
      exec(`chcp 65001 >nul && powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true, encoding: 'utf-8' }, (error, stdout) => {
        if (error || !stdout || stdout.trim() === "null") {
          exec(`powershell "Get-Process | Where-Object {$_.ProcessName -eq 'Spotify'} | Select-Object MainWindowTitle"`, { windowsHide: true }, (err, out) => {
            if (err || !out) return resolve(null);
            const title = out.split('\n').find(l => l.includes('-'))?.trim();
            if (title) {
              const [artist, song] = title.split(' - ');
              resolve({
                name: song || title,
                artist: artist || "Unknown",
                state: 'playing',
                source: 'Spotify'
              });
            } else {
              resolve(null);
            }
          });
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const thumbUrl = data.Thumb ? `data:image/png;base64,${data.Thumb}` : null;
          resolve({
            name: data.Title || "Unknown Title",
            artist: data.Artist || "Unknown Artist",
            album: data.Album || "",
            artwork_url: thumbUrl,
            state: data.Status === 'playing' ? 'playing' : 'paused',
            source: data.Source || 'System'
          });
        } catch (e) {
          resolve(null);
        }
      });

    } else if (platform === 'linux') {
      exec('playerctl metadata --format "{{title}}||{{artist}}||{{album}}||{{status}}"', (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const parts = stdout.trim().split('||');
        resolve({
          name: parts[0],
          artist: parts[1],
          album: parts[2],
          state: parts[3].toLowerCase(),
          source: 'System'
        });
      });
    } else {
      resolve(null);
    }
  });
}

const audioHelperCS = `
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
    int NotImpl0(); int NotImpl1();
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl Session);
}
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl {
    int GetState(out int pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute(bool bMute, ref Guid EventContext);
    int GetMute(out bool pbMute);
}
public class AudioHelper {
    static ISimpleAudioVolume FindByName(string name) {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        device.Activate(ref iid, 0x17, IntPtr.Zero, out o);
        IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
        int count; se.GetCount(out count);
        for (int i = 0; i < count; i++) {
            IAudioSessionControl ctl; se.GetSession(i, out ctl);
            string dn; ctl.GetDisplayName(out dn);
            if (dn != null && dn.Equals(name, StringComparison.OrdinalIgnoreCase))
                return (ISimpleAudioVolume)ctl;
        }
        return null;
    }
    public static float Get(string name) {
        var v = FindByName(name); if (v == null) return -1;
        float l; v.GetMasterVolume(out l); return l;
    }
    public static bool Set(string name, float level) {
        var v = FindByName(name); if (v == null) return false;
        Guid g = Guid.Empty; v.SetMasterVolume(level, ref g); return true;
    }
}
`.trim();

function getSpotifyVolume() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const psScript = `Add-Type -TypeDefinition @"\n${audioHelperCS}\n"@\nWrite-Output ([AudioHelper]::Get("Spotify"))`;
    const tmpFile = path.join(app.getPath('temp'), 'ripple-vol-get.ps1');
    fs.writeFileSync(tmpFile, psScript, 'utf8');
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true }, (error, stdout) => {
      if (error || !stdout) return resolve(null);
      const val = parseFloat(stdout.trim());
      if (isNaN(val) || val < 0) return resolve(null);
      resolve(Math.round(val * 100));
    });
  });
}

function setSpotifyVolume(volumePercent) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const level = (Math.max(0, Math.min(100, volumePercent)) / 100).toFixed(2);
    const psScript = `Add-Type -TypeDefinition @"\n${audioHelperCS}\n"@\n[AudioHelper]::Set("Spotify", ${level})`;
    const tmpFile = path.join(app.getPath('temp'), 'ripple-vol-set.ps1');
    fs.writeFileSync(tmpFile, psScript, 'utf8');
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

ipcMain.handle('get-bluetooth-status', async () => {
  return new Promise((resolve) => {
    const platform = process.platform;
    if (platform === 'darwin') {
      exec('system_profiler SPBluetoothDataType -json', (error, stdout) => {
        if (error) return resolve(false);
        try {
          const data = JSON.parse(stdout);
          const bluetoothData = data.SPBluetoothDataType[0];
          const hasConnectedDevices = bluetoothData.device_connected && bluetoothData.device_connected.length > 0;
          resolve(hasConnectedDevices);
        } catch (e) {
          resolve(false);
        }
      });
    } else if (platform === 'win32') {
      const psScript = `
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $devices = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]::FindAllAsync('(System.Devices.Aep.ProtocolId:="{e0cbf06c-5021-4943-9112-460f89956c33}") AND (System.Devices.Aep.IsConnected:=$true)').GetAwaiter().GetResult()
        return $devices.Count > 0
      `;
      exec(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
        if (error) return resolve(false);
        resolve(stdout.trim().toLowerCase() === 'true');
      });
    } else if (platform === 'linux') {
      exec('bluetoothctl devices Connected', (error, stdout) => {
        if (error) return resolve(false);
        resolve(stdout.trim().length > 0);
      });
    } else {
      resolve(false);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform === 'linux' && !tray) {
    app.quit();
  }
});

// System Media Controls Handler
ipcMain.handle('control-system-media', async (event, command) => {
  const platform = process.platform;
  if (platform === 'darwin') {
    const script = `
        tell application "System Events"
            set spotifyRunning to (name of every process) contains "Spotify"
            set musicRunning to (name of every process) contains "Music"
        end tell
        if spotifyRunning then
            tell application "Spotify" to ${command} track
        else if musicRunning then
            tell application "Music" to ${command} track
        end if
        `;
    exec(`osascript -e '${script}'`);
  } else if (platform === 'linux') {
    let cmd = command;
    if (command === 'playpause') cmd = 'play-pause';
    exec(`playerctl ${cmd}`);
  } else if (platform === 'win32') {
    const actionMap = {
      playpause: 'TryTogglePlayPauseAsync',
      next: 'TrySkipNextAsync',
      previous: 'TrySkipPreviousAsync'
    };
    const action = actionMap[command];
    if (action) {
      const psScript = [
        '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
        'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
        "$asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]",
        'Function Await($WinRtTask,$ResultType){$asTask=$asTaskGeneric.MakeGenericMethod($ResultType);$netTask=$asTask.Invoke($null,@($WinRtTask));$netTask.Wait(-1)|Out-Null;$netTask.Result}',
        '$manager=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
        '$s=$manager.GetCurrentSession()',
        `if($s){Await ($s.${action}()) ([bool])}`
      ].join('\n');
      const tmpFile = path.join(app.getPath('temp'), 'ripple-media-ctrl.ps1');
      fs.writeFileSync(tmpFile, psScript, 'utf8');
      exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true });
    }
  }
});

ipcMain.handle('get-spotify-volume', async () => {
  return await getSpotifyVolume();
});

ipcMain.handle('set-spotify-volume', async (event, volume) => {
  return await setSpotifyVolume(volume);
});