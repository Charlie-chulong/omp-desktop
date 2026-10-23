param(
  [Parameter(Mandatory = $true)][string]$RequestPath
)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OmpOwnedWindowProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string name, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool DestroyWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool UpdateWindow(IntPtr hwnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out uint value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  private static void Contention(string reason) {
    throw new InvalidOperationException("SMOKE_FOCUS_CONTENTION: " + reason +
      "; capture discarded (environment contention, not a renderer failure)");
  }
  private static bool SameRect(RECT first, RECT second) {
    return first.Left == second.Left && first.Top == second.Top &&
      first.Right == second.Right && first.Bottom == second.Bottom;
  }
  private static uint ReadCloaked(IntPtr hwnd) {
    uint cloaked;
    if (DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(uint)) != 0)
      Contention("cannot establish native surface visibility");
    return cloaked;
  }
  private static void AssertSurfaceClear(IntPtr hwnd, RECT capture) {
    if (!IsWindow(hwnd)) Contention("native z-order changed during inspection");
    if (!IsWindowVisible(hwnd) || ReadCloaked(hwnd) != 0) return;
    RECT bounds;
    if (!GetWindowRect(hwnd, out bounds)) Contention("cannot establish native surface geometry");
    // Conservative whole rectangles include layered/transparent surfaces and
    // invisible resize borders; never query another window's text or pixels.
    if (bounds.Left < capture.Right && bounds.Right > capture.Left &&
        bounds.Top < capture.Bottom && bounds.Bottom > capture.Top)
      Contention("a native surface overlaps the owned main client");
  }
  public static void AssertUnoccluded(IntPtr target, RECT capture) {
    if (!IsWindow(target) || GetAncestor(target, 2) != target)
      Contention("owned main is no longer a top-level window");
    var chain = new List<IntPtr>();
    var seen = new HashSet<IntPtr>();
    IntPtr current = target;
    while (current != IntPtr.Zero) {
      if (chain.Count >= 16384 || !seen.Add(current) || !IsWindow(current))
        Contention("native z-order traversal is unstable");
      chain.Add(current);
      if (current != target) AssertSurfaceClear(current, capture);
      IntPtr previous = GetWindow(current, 3); // GW_HWNDPREV: toward the top.
      if (previous == IntPtr.Zero && GetTopWindow(IntPtr.Zero) != current)
        Contention("cannot establish the top of native z-order");
      current = previous;
    }
    // Recheck every link and surface, not just the traversal endpoints. A
    // disappearing HWND, cycle or concurrent reorder is an environment failure.
    for (int index = 0; index < chain.Count; index++) {
      current = chain[index];
      IntPtr expected = index + 1 < chain.Count ? chain[index + 1] : IntPtr.Zero;
      if (!IsWindow(current) || GetWindow(current, 3) != expected)
        Contention("native z-order changed during inspection");
      if (current != target) AssertSurfaceClear(current, capture);
    }
    if (GetTopWindow(IntPtr.Zero) != chain[chain.Count - 1])
      Contention("native z-order changed during inspection");
  }
  public static void AssertUnderlay(IntPtr hwnd, IntPtr target, RECT capture) {
    uint pid = 0;
    RECT bounds = new RECT();
    long extended = GetWindowLongPtr(hwnd, -20).ToInt64();
    if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, out pid) == 0 ||
        pid != GetCurrentProcessId() || !IsWindowVisible(hwnd) ||
        GetAncestor(hwnd, 2) != hwnd || !GetWindowRect(hwnd, out bounds) ||
        !SameRect(bounds, capture) || (extended & 0x08000080L) != 0x08000080L ||
        (extended & 0x00080020L) != 0 || ReadCloaked(hwnd) != 0)
      Contention("controlled opaque backing check failed" +
        " (ownedPid=" + (pid == GetCurrentProcessId()) +
        ", bounds=" + SameRect(bounds, capture) +
        ", extendedStyle=0x" + extended.ToString("X8") + ")");
    // Invisible IME/utility HWNDs may sit between surfaces. Reject every
    // visible overlapping surface until reaching our controlled backing.
    var chain = new List<IntPtr>();
    var seen = new HashSet<IntPtr>();
    IntPtr current = target;
    while (current != hwnd) {
      if (current == IntPtr.Zero || chain.Count >= 16384 || !seen.Add(current) || !IsWindow(current))
        Contention("controlled backing is not below the owned main");
      chain.Add(current);
      if (current != target) AssertSurfaceClear(current, capture);
      current = GetWindow(current, 2);
    }
    for (int index = 0; index < chain.Count; index++) {
      IntPtr expected = index + 1 < chain.Count ? chain[index + 1] : hwnd;
      if (!IsWindow(chain[index]) || GetWindow(chain[index], 2) != expected)
        Contention("controlled backing z-order changed during inspection");
      if (index != 0) AssertSurfaceClear(chain[index], capture);
    }
  }
  public static IntPtr CreateBlackUnderlay(IntPtr target, RECT capture) {
    // This HWND belongs to this probe, not to the app: making it an owned popup
    // of the app would force it ABOVE its owner rather than behind the client.
    uint extendedStyle = 0x08000080;
    if ((GetWindowLongPtr(target, -20).ToInt64() & 0x00000008L) != 0)
      extendedStyle |= 0x00000008;
    IntPtr hwnd = CreateWindowEx(extendedStyle, "STATIC", null, 0x80000004,
      capture.Left, capture.Top, capture.Right - capture.Left, capture.Bottom - capture.Top,
      IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); // NOACTIVATE | TOOLWINDOW, POPUP | SS_BLACKRECT.
    if (hwnd == IntPtr.Zero) Contention("cannot create controlled opaque backing");
    try {
      uint pid;
      if (GetWindowThreadProcessId(hwnd, out pid) == 0 || pid != GetCurrentProcessId())
        Contention("cannot prove controlled backing ownership");
      if (!SetWindowPos(hwnd, target, capture.Left, capture.Top,
          capture.Right - capture.Left, capture.Bottom - capture.Top, 0x0050))
        Contention("cannot position controlled opaque backing"); // NOACTIVATE | SHOWWINDOW.
      if (!UpdateWindow(hwnd) || DwmFlush() != 0)
        Contention("cannot establish controlled backing presentation");
      AssertUnderlay(hwnd, target, capture);
      return hwnd;
    } catch {
      DestroyOwnedUnderlay(hwnd);
      throw;
    }
  }
  public static void DestroyOwnedUnderlay(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return;
    uint pid;
    if (GetWindowThreadProcessId(hwnd, out pid) == 0 || pid != GetCurrentProcessId())
      Contention("cannot prove controlled backing ownership during cleanup");
    if (!DestroyWindow(hwnd)) Contention("cannot destroy controlled opaque backing");
  }
  public static int HitTest(IntPtr target, int x, int y) {
    if (x < short.MinValue || x > short.MaxValue || y < short.MinValue || y > short.MaxValue)
      throw new InvalidOperationException("SMOKE_DESKTOP_UNAVAILABLE: hit-test point exceeds signed physical-coordinate range");
    uint packed = (uint)(ushort)x | ((uint)(ushort)y << 16);
    UIntPtr hit;
    if (SendMessageTimeout(target, 0x0084, UIntPtr.Zero, new IntPtr(unchecked((int)packed)), 0x0023, 100, out hit) == IntPtr.Zero)
      throw new InvalidOperationException("SMOKE_UNSTABLE_GEOMETRY: owned WM_NCHITTEST timed out/failed");
    return unchecked((int)hit.ToUInt64());
  }
  [DllImport("user32.dll", SetLastError=true)]
  private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
}
'@
if (-not [OmpOwnedWindowProbe]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) {
  [void][OmpOwnedWindowProbe]::SetProcessDPIAware()
}
# A manifested PowerShell host may already have fixed process DPI awareness.
# Require unvirtualized physical coordinates on the actual capture thread.
if ([OmpOwnedWindowProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero) {
  throw 'SMOKE_DESKTOP_UNAVAILABLE: cannot establish physical-pixel capture coordinates'
}
$handle = [IntPtr]::new([long]::Parse([string]$request.handle))
function Get-OwnedWindowState {
  [uint32]$ownerPid = 0
  [void][OmpOwnedWindowProbe]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
  # Never read titles/content, activate, or capture a window outside the owned app.
  if (-not [OmpOwnedWindowProbe]::IsWindow($handle) -or $ownerPid -ne [uint32]$request.pid) {
    throw 'SMOKE_FOCUS_CONTENTION: isolated native handle disappeared or changed ownership (environment contention, not a renderer failure)'
  }
  $outer = New-Object OmpOwnedWindowProbe+RECT
  $client = New-Object OmpOwnedWindowProbe+RECT
  $origin = New-Object OmpOwnedWindowProbe+POINT
  if (-not [OmpOwnedWindowProbe]::GetWindowRect($handle, [ref]$outer) -or
      -not [OmpOwnedWindowProbe]::GetClientRect($handle, [ref]$client) -or
      -not [OmpOwnedWindowProbe]::ClientToScreen($handle, [ref]$origin)) {
    throw 'SMOKE_UNSTABLE_GEOMETRY: cannot read the owned native window geometry (environment contention, not a renderer failure)'
  }
  $style = [OmpOwnedWindowProbe]::GetWindowLongPtr($handle, -16).ToInt64()
  $extended = [OmpOwnedWindowProbe]::GetWindowLongPtr($handle, -20).ToInt64()
  return [ordered]@{
    pid = $ownerPid
    handle = [string]$request.handle
    visible = [OmpOwnedWindowProbe]::IsWindowVisible($handle)
    minimized = [OmpOwnedWindowProbe]::IsIconic($handle)
    maximized = [OmpOwnedWindowProbe]::IsZoomed($handle)
    style = ('0x{0:X8}' -f ($style -band 0xffffffffL))
    extendedStyle = ('0x{0:X8}' -f ($extended -band 0xffffffffL))
    noActivate = (($extended -band 0x08000000) -ne 0)
    toolWindow = (($extended -band 0x00000080) -ne 0)
    appWindow = (($extended -band 0x00040000) -ne 0)
    topmost = (($extended -band 0x00000008) -ne 0)
    dpi = [OmpOwnedWindowProbe]::GetDpiForWindow($handle)
    bounds = @{ x = $outer.Left; y = $outer.Top; width = $outer.Right - $outer.Left; height = $outer.Bottom - $outer.Top }
    clientSize = @{ width = $client.Right - $client.Left; height = $client.Bottom - $client.Top }
    clientOrigin = @{ x = $origin.X; y = $origin.Y }
    foreground = ([OmpOwnedWindowProbe]::GetForegroundWindow() -eq $handle)
  }
}
function Get-GeometryKey($state) {
  return (@($state.bounds.x, $state.bounds.y, $state.bounds.width, $state.bounds.height,
    $state.clientOrigin.x, $state.clientOrigin.y, $state.clientSize.width, $state.clientSize.height,
    $state.dpi, $state.maximized) -join ',')
}
function Get-CaptureBounds($state) {
  $bounds = New-Object OmpOwnedWindowProbe+RECT
  $bounds.Left = $state.clientOrigin.x
  $bounds.Top = $state.clientOrigin.y
  $bounds.Right = $bounds.Left + $state.clientSize.width
  $bounds.Bottom = $bounds.Top + $state.clientSize.height
  return $bounds
}
function Assert-CaptureGuard($reference, [IntPtr]$underlay) {
  $state = Get-OwnedWindowState
  if (-not $state.visible -or $state.minimized -or -not $state.foreground) {
    throw 'SMOKE_FOCUS_CONTENTION: owned main window lost foreground/visibility; capture discarded (not a renderer failure)'
  }
  if ((Get-GeometryKey $state) -ne (Get-GeometryKey $reference)) {
    throw 'SMOKE_UNSTABLE_GEOMETRY: owned main window moved/resized during capture; capture discarded'
  }
  $capture = Get-CaptureBounds $state
  $left = [OmpOwnedWindowProbe]::GetSystemMetrics(76)
  $top = [OmpOwnedWindowProbe]::GetSystemMetrics(77)
  $right = $left + [OmpOwnedWindowProbe]::GetSystemMetrics(78)
  $bottom = $top + [OmpOwnedWindowProbe]::GetSystemMetrics(79)
  if ($state.clientSize.width -lt 1 -or $state.clientSize.height -lt 1 -or
      $capture.Left -lt $left -or $capture.Top -lt $top -or
      $capture.Right -gt $right -or $capture.Bottom -gt $bottom) {
    throw 'SMOKE_DESKTOP_UNAVAILABLE: owned main client is not entirely on the visible desktop'
  }
  if ($underlay -ne [IntPtr]::Zero) {
    [OmpOwnedWindowProbe]::AssertUnderlay($underlay, $handle, $capture)
  }
  [OmpOwnedWindowProbe]::AssertUnoccluded($handle, $capture)
  return $state
}
$result = Get-OwnedWindowState
if ($request.chromeHitTests) {
  if ($result.minimized -or $result.maximized) { throw 'Chrome resize hit-tests require the normal owned main window' }
  $bounds = $result.bounds
  $middleX = [int]($bounds.x + [Math]::Floor($bounds.width / 2))
  $middleY = [int]($bounds.y + [Math]::Floor($bounds.height / 2))
  $tests = @(
    @{ name = 'left'; expected = 10; x = $bounds.x + 1; y = $middleY },
    @{ name = 'right'; expected = 11; x = $bounds.x + $bounds.width - 2; y = $middleY },
    @{ name = 'top'; expected = 12; x = $middleX; y = $bounds.y + 1 },
    @{ name = 'bottom'; expected = 15; x = $middleX; y = $bounds.y + $bounds.height - 2 }
  )
  foreach ($test in $tests) {
    $before = Get-OwnedWindowState
    if ((Get-GeometryKey $before) -ne (Get-GeometryKey $result)) { throw 'Owned geometry changed before chrome hit-test' }
    $test.hit = [OmpOwnedWindowProbe]::HitTest($handle, [int]$test.x, [int]$test.y)
    $after = Get-OwnedWindowState
    if ((Get-GeometryKey $after) -ne (Get-GeometryKey $result)) { throw 'Owned geometry changed during chrome hit-test' }
  }
  $result.chromeHitTests = $tests
}
if ($request.screenshot) {
  if ($request.captureTarget -ne 'main') { throw 'Screen capture is restricted to the owned main window' }
  if (-not $result.visible -or $result.minimized) { throw 'SMOKE_FOCUS_CONTENTION: owned capture target is hidden or minimized (not a renderer failure)' }
  [void][OmpOwnedWindowProbe]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 250
  $result = Get-OwnedWindowState
  $result = Assert-CaptureGuard $result ([IntPtr]::Zero)
  Add-Type -AssemblyName System.Drawing
  $underlay = [IntPtr]::Zero
  $bitmap = $null
  $graphics = $null
  try {
    $underlay = [OmpOwnedWindowProbe]::CreateBlackUnderlay($handle, (Get-CaptureBounds $result))
    [void](Assert-CaptureGuard $result $underlay)
    Start-Sleep -Milliseconds 120
    $result = Assert-CaptureGuard $result $underlay
    $bitmap = New-Object System.Drawing.Bitmap($result.clientSize.width, $result.clientSize.height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    [void](Assert-CaptureGuard $result $underlay)
    $graphics.CopyFromScreen($result.clientOrigin.x, $result.clientOrigin.y, 0, 0, $bitmap.Size)
    $after = Assert-CaptureGuard $result $underlay
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($y = 0; $y -lt $bitmap.Height; $y += [Math]::Max(1, [int]($bitmap.Height / 70))) {
      for ($x = 0; $x -lt $bitmap.Width; $x += [Math]::Max(1, [int]($bitmap.Width / 90))) {
        [void]$colors.Add($bitmap.GetPixel($x, $y).ToArgb())
      }
    }
    [void](Assert-CaptureGuard $after $underlay)
    # Persist only after full-rectangle z-order, owned opaque backing, PID,
    # foreground, geometry and desktop-bounds checks pass before/after the copy.
    $bitmap.Save([string]$request.screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
    $result.screenshot = [string]$request.screenshot
    $result.sampledColors = $colors.Count
    $result.captureGuard = 'owned foreground main; stable full-client rectangle, unoccluded z-order and owned opaque backing before/after'
  } finally {
    try {
      if ($graphics) { $graphics.Dispose() }
      if ($bitmap) { $bitmap.Dispose() }
    } finally {
      [OmpOwnedWindowProbe]::DestroyOwnedUnderlay($underlay)
    }
  }
}
$result | ConvertTo-Json -Depth 8 -Compress
