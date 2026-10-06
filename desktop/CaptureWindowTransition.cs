using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class CaptureWindowTransition {
    const int TransitionsForcedDisabled = 3, Cloak = 13;
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();

    // WindowState changes before Windows finishes painting its minimize animation.
    // Remove this window from composition first, then present the minimized state.
    // No global animation settings or fixed timing guesses are involved.
    internal static async Task PrepareAsync(Form window) {
        if (window.IsDisposed || window.Disposing) throw new OperationCanceledException();
        if (!window.Visible) { Marshal.ThrowExceptionForHR(DwmFlush()); return; }
        IntPtr handle = window.Handle;
        int previousTransitions;
        if (DwmGetWindowAttribute(handle, TransitionsForcedDisabled, out previousTransitions, sizeof(int)) < 0) previousTransitions = 0;
        int on = 1, off = 0;
        bool cloaked = false;
        Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(handle, TransitionsForcedDisabled, ref on, sizeof(int)));
        try {
            Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(handle, Cloak, ref on, sizeof(int)));
            cloaked = true;
            window.WindowState = FormWindowState.Minimized;
            // Let WinForms finish its queued size/visibility work before the
            // compositor fence. Keep the window cloaked throughout that work.
            await Task.Yield();
            if (window.IsDisposed || window.Disposing) throw new OperationCanceledException();
            Marshal.ThrowExceptionForHR(DwmFlush());
            Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(handle, Cloak, ref off, sizeof(int)));
            cloaked = false;
            Marshal.ThrowExceptionForHR(DwmFlush());
            if (window.WindowState != FormWindowState.Minimized) throw new OperationCanceledException();
        } finally {
            // Also undo temporary flags if logout/close interrupts preparation.
            if (cloaked) DwmSetWindowAttribute(handle, Cloak, ref off, sizeof(int));
            DwmSetWindowAttribute(handle, TransitionsForcedDisabled, ref previousTransitions, sizeof(int));
        }
    }
}
