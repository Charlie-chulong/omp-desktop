param(
  [Parameter(Mandatory = $true)][string]$RequestPath
)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $request.pid -or $request.pid -is [string] -or $request.pid -is [bool] -or
    [decimal]$request.pid -le 0 -or [decimal]$request.pid -gt [uint32]::MaxValue -or
    [decimal]$request.pid -ne [decimal]::Truncate([decimal]$request.pid) -or
    $request.handle -isnot [string]) {
  throw 'SMOKE_GESTURE_REQUEST: expected numeric positive pid and decimal HWND string'
}
$handle = [IntPtr]::new([long]::Parse($request.handle, [Globalization.CultureInfo]::InvariantCulture))
if ($handle -eq [IntPtr]::Zero) { throw 'SMOKE_GESTURE_REQUEST: HWND must not be zero' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public sealed class OmpOwnedRestoreSnap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO {
    public uint Size; public RECT Monitor, Work; public uint Flags;
  }
  [StructLayout(LayoutKind.Sequential)] private struct GUITHREADINFO {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public RECT CaretRect;
  }
  [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT {
    public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra;
  }
  [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT Mouse;
  }
  [StructLayout(LayoutKind.Sequential)] private struct INPUT {
    public uint Type; public INPUTUNION Data;
  }
  public sealed class Sample {
    public string phase, moveSizeHandle;
    public long ms;
    public bool leftHeld, inMoveSize, maximized;
    public uint guiFlags;
    public RECT bounds;
    public POINT cursor;
  }
  public sealed class Result {
    public string handle, failure, foregroundHandle;
    public uint pid, foregroundPid, dpi;
    public string coordinateContext = "PER_MONITOR_AWARE_V2";
    public bool passed, leftReleased, cursorRestored, cursorMovedByUser, finalMaximized;
    public int downCount, upCount, captionProbes, captionHit;
    public long downMs, upMs, elapsedMs;
    public POINT captionPoint, restorePoint, topPoint;
    public RECT initialMonitor, snapMonitor;
    public List<Sample> samples = new List<Sample>();
  }
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern int GetWindowLong32(IntPtr hwnd, int index);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out uint value, int size);
  private readonly IntPtr hwnd;
  private readonly uint pid;
  private readonly Stopwatch clock = Stopwatch.StartNew();
  private readonly Result result;
  private bool injectedDown, cursorMoved;
  private POINT originalCursor, lastCursor;
  private OmpOwnedRestoreSnap(IntPtr hwnd, uint pid) {
    this.hwnd = hwnd; this.pid = pid;
    result = new Result { handle = hwnd.ToInt64().ToString(), pid = pid };
  }
  private static void Require(bool condition, string message) {
    if (!condition) throw new InvalidOperationException(message);
  }
  private static long Style(IntPtr hwnd, int index) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, index).ToInt64() : (long)(uint)GetWindowLong32(hwnd, index);
  }
  private static bool Near(POINT a, POINT b) { return Math.Abs((long)a.X - b.X) <= 2 && Math.Abs((long)a.Y - b.Y) <= 2; }
  private static bool Held(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  private void Guard() {
    uint owner;
    Require(IsWindow(hwnd) && GetWindowThreadProcessId(hwnd, out owner) != 0 && owner == pid,
      "owned HWND disappeared or changed PID");
    Require(GetForegroundWindow() == hwnd, "SMOKE_FOCUS_CONTENTION: owned main lost foreground; no further gesture input");
    Require(IsWindowVisible(hwnd) && IsWindowEnabled(hwnd) && !IsIconic(hwnd), "owned main became hidden, disabled, or minimized");
    Require(clock.ElapsedMilliseconds < 11000, "bounded native gesture deadline expired");
  }
  private void InputGuard() {
    Guard();
    int[] keys = { 2, 4, 5, 6, 16, 17, 18, 91, 92 };
    foreach (int key in keys) Require(!Held(key), "SMOKE_INPUT_CONTENTION: user button/modifier held (key=" + key + ")");
    Require(Held(1) == injectedDown, "SMOKE_INPUT_CONTENTION: left-button state changed outside the injected sequence");
    if (cursorMoved) {
      POINT current;
      Require(GetCursorPos(out current) && Near(current, lastCursor), "SMOKE_INPUT_CONTENTION: cursor moved outside the injected sequence");
    }
  }
  private MONITORINFO Monitor() {
    MONITORINFO info = new MONITORINFO { Size = (uint)Marshal.SizeOf(typeof(MONITORINFO)) };
    IntPtr monitor = MonitorFromWindow(hwnd, 0);
    Require(monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info), "cannot establish owned window's current monitor");
    Require(info.Work.Right - info.Work.Left >= 360 && info.Work.Bottom - info.Work.Top >= 320,
      "SMOKE_DESKTOP_UNAVAILABLE: current monitor is too small for the bounded restore gesture");
    return info;
  }
  private bool CaptionAt(POINT point) {
    Require(point.X >= short.MinValue && point.X <= short.MaxValue && point.Y >= short.MinValue && point.Y <= short.MaxValue,
      "caption point exceeds WM_NCHITTEST physical-coordinate range");
    uint packed = (uint)(ushort)point.X | ((uint)(ushort)point.Y << 16);
    UIntPtr hit;
    Require(SendMessageTimeout(hwnd, 0x0084, UIntPtr.Zero, new IntPtr(unchecked((int)packed)), 0x0023, 100, out hit) != IntPtr.Zero,
      "owned WM_NCHITTEST timed out/failed; no input sent");
    result.captionHit = unchecked((int)hit.ToUInt64());
    return result.captionHit == 2;
  }
  private void PointOwned(POINT point) {
    uint owner;
    IntPtr root = GetAncestor(WindowFromPoint(point), 2);
    Require(root == hwnd && GetWindowThreadProcessId(root, out owner) != 0 && owner == pid,
      "SMOKE_FOCUS_CONTENTION: caption point is obstructed or changed ownership; no input sent");
  }
  private POINT FindCaption(MONITORINFO monitor) {
    RECT client; POINT origin = new POINT();
    Require(GetClientRect(hwnd, out client) && ClientToScreen(hwnd, ref origin), "cannot read owned client geometry");
    int[] horizontal = { 50, 35, 65, 25, 75, 15, 85 };
    int[] vertical = { 20, 28, 36, 12, 44, 52, 60, 68 };
    foreach (int y in vertical) foreach (int x in horizontal) {
      Guard();
      POINT point = new POINT {
        X = origin.X + (int)((client.Right - client.Left) * (long)x / 100),
        Y = origin.Y + (int)(y * (long)result.dpi / 96)
      };
      if (point.X < monitor.Monitor.Left || point.X >= monitor.Monitor.Right ||
          point.Y < monitor.Monitor.Top || point.Y >= monitor.Monitor.Bottom) continue;
      result.captionProbes++;
      if (CaptionAt(point)) { PointOwned(point); return point; }
    }
    throw new InvalidOperationException("no safe native HTCAPTION in owned top strip; refusing HTCLIENT/manual-drag input");
  }
  private static INPUT Mouse(uint flags, int x, int y) {
    return new INPUT { Type = 0, Data = new INPUTUNION { Mouse = new MOUSEINPUT { X = x, Y = y, Flags = flags } } };
  }
  private static void SendMouse(uint flags, int x, int y) {
    Require(SendInput(1, new INPUT[] { Mouse(flags, x, y) }, Marshal.SizeOf(typeof(INPUT))) == 1,
      "SendInput failed (win32=" + Marshal.GetLastWin32Error() + ")");
  }
  private void Move(POINT point) {
    InputGuard();
    int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    Require(width > 1 && height > 1 && point.X >= left && (long)point.X < (long)left + width &&
      point.Y >= top && (long)point.Y < (long)top + height, "gesture point is outside the virtual desktop");
    // Target the centre of the physical pixel, including a secondary display's
    // exact top row; endpoint normalization can land one row across its edge.
    int x = (int)Math.Round((((long)point.X - left) + 0.5) * 65536.0 / width);
    int y = (int)Math.Round((((long)point.Y - top) + 0.5) * 65536.0 / height);
    SendMouse(0xC001, x, y); // MOVE | ABSOLUTE | VIRTUALDESK. Never move the window directly.
    cursorMoved = true;
    var wait = Stopwatch.StartNew();
    POINT current = new POINT();
    while (wait.ElapsedMilliseconds < 200) {
      Guard();
      Require(GetCursorPos(out current), "cannot inspect injected cursor");
      if (current.X == point.X && current.Y == point.Y) { lastCursor = current; return; }
      Application.DoEvents(); Thread.Sleep(5);
    }
    lastCursor = point;
    throw new InvalidOperationException("SMOKE_INPUT_CONTENTION: injected cursor did not reach its owned gesture point");
  }
  private Sample Observe(string phase) {
    InputGuard();
    uint owner;
    uint thread = GetWindowThreadProcessId(hwnd, out owner);
    GUITHREADINFO gui = new GUITHREADINFO { Size = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
    Require(thread != 0 && owner == pid && GetGUIThreadInfo(thread, ref gui), "cannot inspect owned GUI move loop");
    var sample = new Sample {
      phase = phase, ms = clock.ElapsedMilliseconds, leftHeld = Held(1), guiFlags = gui.Flags,
      moveSizeHandle = gui.MoveSize.ToInt64().ToString(),
      inMoveSize = (gui.Flags & 2) != 0 && gui.MoveSize == hwnd, maximized = IsZoomed(hwnd)
    };
    Require(GetWindowRect(hwnd, out sample.bounds) && GetCursorPos(out sample.cursor), "cannot sample owned native geometry/cursor");
    result.samples.Add(sample);
    return sample;
  }
  private void Pause(int ms) { Application.DoEvents(); Thread.Sleep(ms); }
  private void Path(POINT start, POINT end, string phase) {
    for (int step = 1; step <= 18; step++) {
      Move(new POINT { X = start.X + (int)((end.X - (long)start.X) * step / 18),
        Y = start.Y + (int)((end.Y - (long)start.Y) * step / 18) });
      Pause(25); Observe(phase);
    }
  }
  private void Hold(string phase, int samples) {
    for (int index = 0; index < samples; index++) {
      Pause(40);
      Sample state = Observe(phase);
      Require(state.leftHeld && state.inMoveSize && !state.maximized,
        phase + ": held restored window must remain inside the owned system move loop");
    }
  }
  private void Release() {
    // Cleanup may only release OUR injected down; it never reacquires foreground
    // or clicks an unrelated surface after contention. Match the focus helper's
    // emergency-up fallback so a failed SendInput cannot leave a button held.
    if (!injectedDown) return;
    if (SendInput(1, new INPUT[] { Mouse(0x0004, 0, 0) }, Marshal.SizeOf(typeof(INPUT))) != 1)
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    result.upCount++; result.upMs = clock.ElapsedMilliseconds;
    injectedDown = false;
    var wait = Stopwatch.StartNew();
    while (Held(1) && wait.ElapsedMilliseconds < 200) Pause(5);
    Require(!Held(1), "could not release injected left button");
  }
  private void Execute() {
    IntPtr oldDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      Require(oldDpi != IntPtr.Zero && AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), new IntPtr(-4)),
        "SMOKE_DESKTOP_UNAVAILABLE: cannot establish PMv2 physical coordinates");
      InputGuard();
      Require(GetAncestor(hwnd, 2) == hwnd && (Style(hwnd, -16) & 0x40000000L) == 0 && (Style(hwnd, -20) & 0x08000000L) == 0,
        "owned main must be an activatable top-level window");
      uint cloaked;
      Require(DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(uint)) == 0 && cloaked == 0, "owned main is cloaked or visibility is unavailable");
      Require(IsZoomed(hwnd), "continuous restore-to-top regression must start maximized");
      result.dpi = GetDpiForWindow(hwnd);
      Require(result.dpi > 0 && GetCursorPos(out originalCursor), "cannot save owned DPI/cursor context");
      MONITORINFO monitor = Monitor(); result.initialMonitor = monitor.Monitor;
      result.captionPoint = FindCaption(monitor);
      Move(result.captionPoint);
      Pause(80); InputGuard(); PointOwned(result.captionPoint);
      Require(IsZoomed(hwnd) && CaptionAt(result.captionPoint), "maximized native caption changed before left down");
      Observe("before-down");
      // Exactly one down and one up span BOTH legs and both held pauses.
      SendMouse(0x0002, 0, 0); injectedDown = true;
      result.downCount++; result.downMs = clock.ElapsedMilliseconds;
      Pause(60); Observe("held-down");
      result.restorePoint = new POINT {
        X = result.captionPoint.X,
        Y = monitor.Work.Top + Math.Min(360, (monitor.Work.Bottom - monitor.Work.Top) * 45 / 100)
      };
      Require(result.restorePoint.Y - result.captionPoint.Y >= 80, "not enough on-monitor distance for native restore drag");
      Path(result.captionPoint, result.restorePoint, "restore-drag");
      Hold("restored-held", 10);
      // Query the CURRENT window monitor after restoration, never assume the
      // primary display or a saved fixed desktop origin (negative origins work).
      monitor = Monitor(); result.snapMonitor = monitor.Monitor;
      result.topPoint = new POINT { X = Math.Max(monitor.Work.Left + 80, Math.Min(result.restorePoint.X, monitor.Work.Right - 81)), Y = monitor.Monitor.Top };
      Path(result.restorePoint, result.topPoint, "return-top");
      Hold("top-held", 20);
      InputGuard(); Release();
      for (int attempt = 0; attempt < 100; attempt++) {
        Pause(20);
        Sample sample = Observe("released-at-top");
        if (sample.maximized && !sample.inMoveSize) break;
      }
      result.finalMaximized = IsZoomed(hwnd);
      Require(result.finalMaximized, "release at current monitor top did not maximize: continuous native Snap failed");
      Require(result.samples[result.samples.Count - 1].inMoveSize == false, "owned system move loop did not end after release");
    } catch (Exception error) {
      result.failure = error.Message;
    } finally {
      try { Release(); } catch (Exception error) { result.failure = (result.failure ?? "") + "; cleanup: " + error.Message; }
      result.leftReleased = !Held(1);
      if (cursorMoved) {
        POINT current;
        if (!GetCursorPos(out current)) result.failure = (result.failure ?? "") + "; cannot inspect cursor during cleanup";
        else if (Near(current, lastCursor) && !Held(1) && !Held(2) && !Held(4) && !Held(5) && !Held(6)) {
          result.cursorRestored = SetCursorPos(originalCursor.X, originalCursor.Y);
          if (!result.cursorRestored) result.failure = (result.failure ?? "") + "; cannot restore unchanged injected cursor";
        } else result.cursorMovedByUser = true;
      }
      if (oldDpi != IntPtr.Zero && SetThreadDpiAwarenessContext(oldDpi) == IntPtr.Zero)
        result.failure = (result.failure ?? "") + "; cannot restore helper DPI context";
    }
    IntPtr foreground = GetForegroundWindow();
    result.foregroundHandle = foreground.ToInt64().ToString();
    uint foregroundPid; GetWindowThreadProcessId(foreground, out foregroundPid); result.foregroundPid = foregroundPid;
    result.elapsedMs = clock.ElapsedMilliseconds;
    result.passed = result.failure == null && result.leftReleased && result.cursorRestored && result.downCount == 1 && result.upCount == 1 && foreground == hwnd;
    if (!result.passed && result.failure == null) result.failure = "gesture cleanup/foreground invariant failed";
  }
  public static Result Run(IntPtr hwnd, uint pid) {
    var gesture = new OmpOwnedRestoreSnap(hwnd, pid); gesture.Execute(); return gesture.result;
  }
}
'@
# Geometry, button state, and owned GUI-thread flags only. No desktop pixels,
# window text, user data, OS setting changes, or production test-mode switches.
[OmpOwnedRestoreSnap]::Run($handle, [uint32]$request.pid) | ConvertTo-Json -Compress -Depth 8
