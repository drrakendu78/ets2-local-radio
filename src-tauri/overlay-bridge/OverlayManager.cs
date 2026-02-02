using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Timers;
using Capture;
using Capture.Hook;
using Capture.Interface;

namespace OverlayBridge
{
    public class OverlayManager
    {
        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hwnd, ref Rect rectangle);

        private struct Rect
        {
            public int Left { get; set; }
            public int Top { get; set; }
            public int Right { get; set; }
            public int Bottom { get; set; }
        }

        private CaptureProcess _captureProcess;
        private Timer _hideTimer;
        private int _windowWidth;
        private int _windowHeight;
        private string _resourcePath;

        public bool IsAttached => _captureProcess != null && !_captureProcess.Process.HasExited;
        public string CurrentGame { get; private set; }

        public OverlayManager()
        {
            _hideTimer = new Timer(4000);
            _hideTimer.Elapsed += OnHideTimerElapsed;
            _hideTimer.AutoReset = false;

            // Find resources path
            _resourcePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources");
            if (!Directory.Exists(_resourcePath))
            {
                _resourcePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory);
            }
        }

        public bool Attach(string game)
        {
            // If already attached to the same game, return success
            if (IsAttached && CurrentGame == game)
            {
                Console.WriteLine($"Already attached to {game}");
                return true;
            }

            Detach();

            string processName = game == "ats" ? "amtrucks" : "eurotrucks2";
            CurrentGame = game;

            // Save current directory and change to the application base directory
            // EasyHook looks for EasyLoad64.dll relative to the current directory
            string originalDirectory = Environment.CurrentDirectory;
            string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;

            try
            {
                // Change to the directory containing the DLLs
                Environment.CurrentDirectory = baseDirectory;
                Console.WriteLine($"Changed working directory to: {baseDirectory}");

                Process[] processes = Process.GetProcessesByName(processName);
                foreach (Process p in processes)
                {
                    if (p.MainWindowHandle == IntPtr.Zero)
                        continue;

                    if (HookManager.IsHooked(p.Id))
                        continue;

                    CaptureConfig config = new CaptureConfig()
                    {
                        Direct3DVersion = Direct3DVersion.AutoDetect,
                        ShowOverlay = true
                    };

                    var captureInterface = new CaptureInterface();
                    captureInterface.RemoteMessage += msg =>
                    {
                        Console.WriteLine($"Remote: {msg}");
                    };

                    // Debug: show the path of Capture.dll that will be injected
                    string captureDllPath = typeof(CaptureInterface).Assembly.Location;
                    Console.WriteLine($"Capture.dll location: {captureDllPath}");
                    Console.WriteLine($"File exists: {System.IO.File.Exists(captureDllPath)}");
                    Console.WriteLine($"Current directory: {Environment.CurrentDirectory}");

                    // Check all EasyHook related files
                    string easyHookLocation = typeof(EasyHook.RemoteHooking).Assembly.Location;
                    string easyHookDir = Path.GetDirectoryName(easyHookLocation);
                    Console.WriteLine($"EasyHook.dll location: {easyHookLocation}");
                    Console.WriteLine($"EasyHook directory: {easyHookDir}");
                    Console.WriteLine($"EasyLoad64.dll in base: {System.IO.File.Exists(Path.Combine(baseDirectory, "EasyLoad64.dll"))}");
                    Console.WriteLine($"EasyLoad64.dll in EasyHook dir: {System.IO.File.Exists(Path.Combine(easyHookDir, "EasyLoad64.dll"))}");
                    Console.WriteLine($"EasyHook64.dll in base: {System.IO.File.Exists(Path.Combine(baseDirectory, "EasyHook64.dll"))}");
                    Console.WriteLine($"EasyHook64.dll in EasyHook dir: {System.IO.File.Exists(Path.Combine(easyHookDir, "EasyHook64.dll"))}");

                    _captureProcess = new CaptureProcess(p, config, captureInterface);

                    // Get window size
                    Rect rect = new Rect();
                    GetWindowRect(p.MainWindowHandle, ref rect);
                    _windowWidth = rect.Right - rect.Left;
                    _windowHeight = rect.Bottom - rect.Top;

                    Console.WriteLine($"Attached to {processName} (PID: {p.Id}, Size: {_windowWidth}x{_windowHeight})");
                    return true;
                }

                Console.WriteLine($"Process not found: {processName}");
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Attach error: {ex.Message}");
                Console.WriteLine($"Exception type: {ex.GetType().FullName}");
                if (ex is System.Runtime.InteropServices.COMException comEx)
                {
                    Console.WriteLine($"COM HResult: 0x{comEx.HResult:X8}");
                }
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner error: {ex.InnerException.Message}");
                    Console.WriteLine($"Inner type: {ex.InnerException.GetType().FullName}");
                    if (ex.InnerException is System.ComponentModel.Win32Exception win32Ex)
                    {
                        Console.WriteLine($"Win32 error code: {win32Ex.NativeErrorCode}");
                    }
                }
                Console.WriteLine($"Stack trace: {ex.StackTrace}");

                // Also print full exception to see all details
                Console.WriteLine($"\nFull exception:\n{ex}");
                return false;
            }
            finally
            {
                // Restore original directory
                Environment.CurrentDirectory = originalDirectory;
            }
        }

        public void Detach()
        {
            if (_captureProcess != null)
            {
                try
                {
                    HookManager.RemoveHookedProcess(_captureProcess.Process.Id);
                    _captureProcess.CaptureInterface?.Disconnect();
                }
                catch { }
                _captureProcess = null;
            }
            CurrentGame = null;
        }

        public void ShowStation(string stationName, string signal, string logoPath, string nowPlayingText, bool rtl)
        {
            if (!IsAttached)
            {
                Console.WriteLine("Not attached to any process");
                return;
            }

            try
            {
                // Update window size
                Rect rect = new Rect();
                GetWindowRect(_captureProcess.Process.MainWindowHandle, ref rect);
                _windowWidth = rect.Right - rect.Left;
                _windowHeight = rect.Bottom - rect.Top;

                // Load overlay background
                string overlayBgPath = Path.Combine(_resourcePath, "overlay_double.png");
                if (!File.Exists(overlayBgPath))
                {
                    Console.WriteLine($"Overlay background not found: {overlayBgPath}");
                    return;
                }

                using (Image bmp = Image.FromFile(overlayBgPath))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

                    // Draw station name
                    DrawStationName(g, bmp, stationName, nowPlayingText, rtl);

                    // Draw signal strength
                    DrawSignalStrength(g, bmp, signal);

                    // Draw logo if provided
                    if (!string.IsNullOrEmpty(logoPath))
                    {
                        DrawLogo(g, bmp, logoPath);
                    }

                    g.Flush();

                    // Create overlay
                    var overlay = new Capture.Hook.Common.Overlay
                    {
                        Elements = new List<Capture.Hook.Common.IOverlayElement>
                        {
                            new Capture.Hook.Common.ImageElement()
                            {
                                Location = new Point((_windowWidth / 2) - (bmp.Width / 2), (_windowHeight / 4)),
                                Image = bmp.ToByteArray(System.Drawing.Imaging.ImageFormat.Png)
                            }
                        },
                        Hidden = false
                    };

                    _captureProcess.CaptureInterface.DrawOverlayInGame(overlay);
                    Console.WriteLine($"Overlay shown: {stationName}");

                    // Start hide timer
                    _hideTimer.Stop();
                    _hideTimer.Start();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ShowStation error: {ex.Message}");
            }
        }

        private void DrawStationName(Graphics g, Image bmp, string stationName, string nowPlayingText, bool rtl)
        {
            using (Font font = new Font("Microsoft Sans Serif", 15, FontStyle.Bold))
            using (Brush orangeBrush = new SolidBrush(Color.FromArgb(255, 174, 0)))
            {
                string fullText = nowPlayingText + " " + stationName;
                SizeF stringSize = g.MeasureString(fullText, font);
                SizeF nowPlayingSize = g.MeasureString(nowPlayingText + " ", font);
                SizeF nameSize = g.MeasureString(stationName, font);

                PointF topLeft = new PointF(
                    (512f / 2) - (stringSize.Width / 2) + 123,
                    (bmp.Height / 2f) - (stringSize.Height / 2)
                );

                if (rtl)
                {
                    g.DrawString(stationName, font, orangeBrush, topLeft);
                    g.DrawString(nowPlayingText, font, Brushes.White,
                        new PointF(topLeft.X + nameSize.Width + nowPlayingSize.Width, topLeft.Y),
                        new StringFormat { FormatFlags = StringFormatFlags.DirectionRightToLeft });
                }
                else
                {
                    g.DrawString(stationName, font, orangeBrush,
                        new PointF(topLeft.X + nowPlayingSize.Width, topLeft.Y));
                    g.DrawString(nowPlayingText, font, Brushes.White, topLeft);
                }
            }
        }

        private void DrawSignalStrength(Graphics g, Image bmp, string signal)
        {
            string signalFile = Path.Combine(_resourcePath, $"{signal}.png");
            if (File.Exists(signalFile))
            {
                using (Image signalImg = Image.FromFile(signalFile))
                {
                    g.DrawImage(signalImg, 593, bmp.Height - 36, 32, 32);
                }
            }
        }

        private void DrawLogo(Graphics g, Image bmp, string logoPath)
        {
            try
            {
                string localPath = logoPath;

                // Download if URL
                if (logoPath.StartsWith("http"))
                {
                    string tempPath = Path.Combine(Path.GetTempPath(), "radio_logo" + Path.GetExtension(logoPath));
                    using (WebClient client = new WebClient())
                    {
                        client.DownloadFile(logoPath, tempPath);
                    }
                    localPath = tempPath;
                }
                else if (!Path.IsPathRooted(logoPath))
                {
                    // Relative path - try multiple locations
                    string relativePath = logoPath.TrimStart('/').Replace("/", "\\");
                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;

                    // Try possible locations for the web folder
                    string[] possiblePaths = new string[]
                    {
                        // In bundled app: resources/web/
                        Path.Combine(baseDir, "web", relativePath),
                        // During dev: ../../../../web/ (from overlay-bridge/bin/Release/)
                        Path.Combine(baseDir, "..", "..", "..", "..", "web", relativePath),
                        // During dev from src-tauri: ../web/
                        Path.Combine(baseDir, "..", "web", relativePath),
                        // Absolute from project root (dev mode)
                        Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "web", relativePath))
                    };

                    localPath = null;
                    foreach (string path in possiblePaths)
                    {
                        string fullPath = Path.GetFullPath(path);
                        Console.WriteLine($"Checking logo path: {fullPath}");
                        if (File.Exists(fullPath))
                        {
                            localPath = fullPath;
                            Console.WriteLine($"Found logo at: {fullPath}");
                            break;
                        }
                    }

                    if (localPath == null)
                    {
                        Console.WriteLine($"Logo not found in any location for: {logoPath}");
                        return;
                    }
                }

                if (!File.Exists(localPath))
                {
                    Console.WriteLine($"Logo not found: {localPath}");
                    return;
                }

                using (Image logo = Image.FromFile(localPath))
                {
                    float logoHeight = logo.Height;
                    float logoWidth = logo.Width;

                    // Scale logo to fit
                    if (logoHeight > 0.41f * logoWidth)
                    {
                        logoWidth = (90f / logoHeight) * logoWidth;
                        logoHeight = 90;
                    }
                    else
                    {
                        logoHeight = (220f / logoWidth) * logoHeight;
                        logoWidth = 220;
                    }

                    g.DrawImage(logo,
                        (256f / 2) - (logoWidth / 2) + 645,
                        (bmp.Height / 2f) - (logoHeight / 2),
                        logoWidth, logoHeight);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Logo error: {ex.Message}");
            }
        }

        public void HideOverlay()
        {
            if (!IsAttached) return;

            try
            {
                _hideTimer.Stop();
                _captureProcess?.CaptureInterface?.DrawOverlayInGame(
                    new Capture.Hook.Common.Overlay
                    {
                        Elements = new List<Capture.Hook.Common.IOverlayElement>()
                    }
                );
                Console.WriteLine("Overlay hidden");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"HideOverlay error: {ex.Message}");
            }
        }

        private void OnHideTimerElapsed(object sender, ElapsedEventArgs e)
        {
            HideOverlay();
        }
    }
}
