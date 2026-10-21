param(
  [Parameter(Mandatory = $true)][string]$RequestPath
)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $request.pid -or $request.pid -is [string] -or $request.pid -is [bool] -or
    [decimal]$request.pid -le 0 -or [decimal]$request.pid -gt [uint32]::MaxValue -or
    [decimal]$request.pid -ne [decimal]::Truncate([decimal]$request.pid) -or
    $request.handle -isnot [string]) {
  throw 'SMOKE_FOCUS_REQUEST: expected numeric positive pid and decimal HWND string'
}
$handle = [IntPtr]::new([long]::Parse($request.handle, [Globalization.CultureInfo]::InvariantCulture))
if ($handle -eq [IntPtr]::Zero) { throw 'SMOKE_FOCUS_REQUEST: HWND must not be zero' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class OmpOwnedWindowFocus {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT {
    public int dx, dy;
    public uint mouseData, dwFlags, time;
    public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
  }
  [StructLayout(LayoutKind.Sequential)] private struct INPUT {
    public uint type;
    public INPUTUNION data;
  }
  public sealed class Result {
    public bool focused, usedOwnedInput, originallyTopmost, topmostRestored, cursorRestored, cursorMovedByUser;
    public string handle, foregroundHandle;
    public uint pid, foregroundPid, dpi;
    public RECT bounds, clientBounds;
    public POINT clientOrigin, captionPoint;
    public int captionProbes;
    public long elapsedMs;
    public string coordinateContext = "PER_MONITOR_AWARE_V2";
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
  [DllImport("user32.dll", SetLastError=true)] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out uint value, int size);
  private const uint PositionFlags = 0x0213; // NOOWNERZORDER | NOACTIVATE | NOMOVE | NOSIZE.
  private static long Style(IntPtr hwnd, int index) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, index).ToInt64() : (long)(uint)GetWindowLong32(hwnd, index);
  }
  private static bool Same(RECT first, RECT second) {
    return first.Left == second.Left && first.Top == second.Top && first.Right == second.Right && first.Bottom == second.Bottom;
  }
  private static bool Same(POINT first, POINT second) { return first.X == second.X && first.Y == second.Y; }
  private static void Require(bool condition, string message) {
    if (!condition) throw new InvalidOperationException(message);
  }
  private static bool Owned(IntPtr hwnd, uint expectedPid) {
    uint actual;
    return IsWindow(hwnd) && GetWindowThreadProcessId(hwnd, out actual) != 0 && actual == expectedPid;
  }
  private static RECT Validate(IntPtr hwnd, uint pid, out RECT client, out POINT origin) {
    Require(Owned(hwnd, pid), "owned HWND disappeared or changed PID");
    Require(GetAncestor(hwnd, 2) == hwnd && (Style(hwnd, -16) & 0x40000000L) == 0, "owned HWND is not top-level");
    Require(IsWindowVisible(hwnd) && IsWindowEnabled(hwnd) && !IsIconic(hwnd) && !IsZoomed(hwnd),
      "owned main must be visible, enabled, and normal (not minimized/maximized)");
    Require((Style(hwnd, -20) & 0x08000000L) == 0, "owned main has WS_EX_NOACTIVATE");
    uint cloaked;
    Require(DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(uint)) == 0 && cloaked == 0, "owned main visibility/cloaking unavailable");
    RECT bounds;
    origin = new POINT();
    Require(GetWindowRect(hwnd, out bounds), "cannot read owned outer geometry");
    Require(GetClientRect(hwnd, out client) && ClientToScreen(hwnd, ref origin), "cannot read owned client geometry");
    Require(bounds.Right > bounds.Left && bounds.Bottom > bounds.Top && client.Right > client.Left && client.Bottom > client.Top,
      "owned main has empty geometry");
    return bounds;
  }
  private static void AssertUnchanged(IntPtr hwnd, uint pid, Result state) {
    RECT client; POINT origin;
    RECT bounds = Validate(hwnd, pid, out client, out origin);
    Require(Same(bounds, state.bounds) && Same(client, state.clientBounds) && Same(origin, state.clientOrigin) && GetDpiForWindow(hwnd) == state.dpi,
      "owned main geometry/DPI changed during focus acquisition");
  }
  private static bool CaptionAt(IntPtr hwnd, POINT point) {
    Require(point.X >= short.MinValue && point.X <= short.MaxValue && point.Y >= short.MinValue && point.Y <= short.MaxValue,
      "caption point exceeds WM_NCHITTEST signed physical-coordinate range");
    uint packed = (uint)(ushort)point.X | ((uint)(ushort)point.Y << 16);
    UIntPtr hit;
    Require(SendMessageTimeout(hwnd, 0x0084, UIntPtr.Zero, new IntPtr(unchecked((int)packed)), 0x0023, 100, out hit) != IntPtr.Zero,
      "owned WM_NCHITTEST timed out/failed; no input sent");
    return hit.ToUInt64() == 2; // HTCAPTION only: never HTCLIENT, buttons, or sizing borders.
  }
  private static POINT FindCaption(IntPtr hwnd, Result state) {
    var search = Stopwatch.StartNew();
    int width = state.bounds.Right - state.bounds.Left;
    int height = state.bounds.Bottom - state.bounds.Top;
    int strip = Math.Min(height / 3, Math.Max(1, (int)(72L * state.dpi / 96)));
    int[] horizontal = { 50, 35, 65, 25, 75, 15, 85 };
    int[] vertical = { 20, 28, 36, 12, 44, 52, 60, 68, 6 };
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
    long vr = (long)vx + GetSystemMetrics(78), vb = (long)vy + GetSystemMetrics(79);
    foreach (int y in vertical) {
      int offset = Math.Max(1, (int)(y * (long)state.dpi / 96));
      if (offset >= strip) continue;
      foreach (int x in horizontal) {
        Require(search.ElapsedMilliseconds < 2500, "bounded caption search expired; no input sent");
        POINT point = new POINT { X = state.bounds.Left + (int)(width * (long)x / 100), Y = state.bounds.Top + offset };
        if (point.X < vx || point.X >= vr || point.Y < vy || point.Y >= vb) continue;
        state.captionProbes++;
        if (CaptionAt(hwnd, point)) return point;
      }
    }
    throw new InvalidOperationException("no safe native HTCAPTION point in owned top strip; refusing client-content click");
  }
  private static void AssertPointOwned(IntPtr hwnd, uint pid, POINT point) {
    IntPtr root = GetAncestor(WindowFromPoint(point), 2);
    Require(root == hwnd && Owned(root, pid), "caption point is obstructed or changed ownership; no input sent");
  }
  private static void AssertInputIdle() {
    int[] keys = { 1, 2, 4, 5, 6, 16, 17, 18, 91, 92 };
    foreach (int key in keys) Require((GetAsyncKeyState(key) & 0x8000) == 0,
      "mouse button/modifier already held; refusing to interfere with user input (key=" + key + ")");
  }
  private static bool MouseButtonsHeld() {
    return (((ushort)GetAsyncKeyState(1) | (ushort)GetAsyncKeyState(2) | (ushort)GetAsyncKeyState(4) |
      (ushort)GetAsyncKeyState(5) | (ushort)GetAsyncKeyState(6)) & 0x8000) != 0;
  }
  private static INPUT Mouse(uint flags) {
    return new INPUT { type = 0, data = new INPUTUNION { mouse = new MOUSEINPUT { dwFlags = flags } } };
  }
  private static void Click() {
    uint sent = 0;
    try {
      // SendInput inserts the pair together, without an intervening user event.
      sent = SendInput(2, new INPUT[] { Mouse(0x0002), Mouse(0x0004) }, Marshal.SizeOf(typeof(INPUT)));
      Require(sent == 2, "SendInput did not insert the complete owned click (count=" + sent + ", win32=" + Marshal.GetLastWin32Error() + ")");
    } finally {
      if (sent == 1) {
        // A partially accepted pair must never leave the injected button down.
        if (SendInput(1, new INPUT[] { Mouse(0x0004) }, Marshal.SizeOf(typeof(INPUT))) != 1)
          mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
      }
    }
  }
  private static void ForegroundMetadata(Result state) {
    IntPtr foreground = GetForegroundWindow();
    state.foregroundHandle = foreground.ToInt64().ToString();
    uint owner;
    GetWindowThreadProcessId(foreground, out owner);
    state.foregroundPid = owner;
  }
  public static Result Focus(IntPtr hwnd, uint pid) {
    var clock = Stopwatch.StartNew();
    var state = new Result { handle = hwnd.ToInt64().ToString(), pid = pid };
    IntPtr oldDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    Require(oldDpi != IntPtr.Zero && AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), new IntPtr(-4)),
      "SMOKE_DESKTOP_UNAVAILABLE: cannot establish PMv2 physical coordinates");
    bool restoreTopmost = false, cursorMoved = false;
    POINT originalCursor = new POINT();
    string failure = null;
    try {
      state.bounds = Validate(hwnd, pid, out state.clientBounds, out state.clientOrigin);
      state.dpi = GetDpiForWindow(hwnd);
      Require(state.dpi > 0, "owned main DPI unavailable");
      state.originallyTopmost = (Style(hwnd, -20) & 8) != 0;
      state.topmostRestored = true;
      if (GetForegroundWindow() != hwnd) {
        AssertInputIdle();
        Require(GetCursorPos(out originalCursor), "cannot save cursor position");
        restoreTopmost = true; // Even a failed native call gets an ownership-checked cleanup attempt.
        state.topmostRestored = false;
        Require(SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, PositionFlags), "cannot raise only owned main without activation");
        AssertUnchanged(hwnd, pid, state);
        state.captionPoint = FindCaption(hwnd, state);
        AssertPointOwned(hwnd, pid, state.captionPoint);
        Require(SetCursorPos(state.captionPoint.X, state.captionPoint.Y), "cannot position cursor over owned caption");
        cursorMoved = true;
        AssertUnchanged(hwnd, pid, state);
        Require(CaptionAt(hwnd, state.captionPoint), "caption hit-test changed; no input sent");
        AssertInputIdle();
        POINT current;
        Require(GetCursorPos(out current) && Same(current, state.captionPoint), "user cursor moved before click; no input sent");
        // Final ownership check immediately precedes the only injected input.
        AssertPointOwned(hwnd, pid, state.captionPoint);
        state.usedOwnedInput = true;
        Click();
        var wait = Stopwatch.StartNew();
        while (GetForegroundWindow() != hwnd && wait.ElapsedMilliseconds < 2000) {
          Application.DoEvents();
          Thread.Sleep(15);
        }
        AssertUnchanged(hwnd, pid, state);
        Require(GetForegroundWindow() == hwnd, "owned caption click did not acquire foreground within 2000ms");
      }
      AssertUnchanged(hwnd, pid, state);
      Require(GetForegroundWindow() == hwnd, "owned main lost foreground during focus acquisition");
    } catch (Exception error) {
      failure = error.Message;
    } finally {
      if (restoreTopmost) {
        if (!Owned(hwnd, pid)) failure = (failure == null ? "" : failure + "; ") + "cannot restore topmost flag: owned HWND disappeared/changed PID";
        else {
          bool restored = SetWindowPos(hwnd, new IntPtr(state.originallyTopmost ? -1 : -2), 0, 0, 0, 0, PositionFlags);
          state.topmostRestored = restored && ((Style(hwnd, -20) & 8) != 0) == state.originallyTopmost;
          if (!state.topmostRestored) failure = (failure == null ? "" : failure + "; ") + "cannot restore owned original topmost flag";
        }
      }
      if (cursorMoved) {
        POINT current;
        if (!GetCursorPos(out current)) failure = (failure == null ? "" : failure + "; ") + "cannot inspect cursor for safe restoration";
        else if (Same(current, state.captionPoint) && !MouseButtonsHeld()) {
          state.cursorRestored = SetCursorPos(originalCursor.X, originalCursor.Y);
          if (!state.cursorRestored) failure = (failure == null ? "" : failure + "; ") + "cannot restore unchanged injected cursor";
        } else state.cursorMovedByUser = true;
      }
      if (failure == null) {
        try { AssertUnchanged(hwnd, pid, state); }
        catch (Exception error) { failure = error.Message; }
      }
      if (SetThreadDpiAwarenessContext(oldDpi) == IntPtr.Zero)
        failure = (failure == null ? "" : failure + "; ") + "cannot restore helper thread DPI context";
    }
    ForegroundMetadata(state);
    state.focused = GetForegroundWindow() == hwnd && Owned(hwnd, pid);
    state.elapsedMs = clock.ElapsedMilliseconds;
    if (failure != null || !state.focused) {
      throw new InvalidOperationException("SMOKE_FOCUS_CONTENTION: " + (failure ?? "owned main lost foreground during cleanup") +
        "; ownedPid=" + pid + "; ownedHwnd=" + state.handle + "; foregroundPid=" + state.foregroundPid +
        "; foregroundHwnd=" + state.foregroundHandle + "; bounds=" + state.bounds.Left + "," + state.bounds.Top + "," + state.bounds.Right + "," + state.bounds.Bottom +
        "; dpi=" + state.dpi + "; captionProbes=" + state.captionProbes + "; captionPoint=" + state.captionPoint.X + "," + state.captionPoint.Y + "; usedOwnedInput=" + state.usedOwnedInput +
        "; topmostRestored=" + state.topmostRestored + "; cursorRestored=" + state.cursorRestored + "; cursorMovedByUser=" + state.cursorMovedByUser);
    }
    return state;
  }
}
'@
[OmpOwnedWindowFocus]::Focus($handle, [uint32]$request.pid) | ConvertTo-Json -Compress -Depth 5
