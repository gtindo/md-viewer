import AppKit

/// Development aid behind MDVIEW_DEBUG_COMMANDS: synthetic input delivered through
/// the application event queue, the path real events take once the window server hands them over,
/// so menus, hit testing and WKWebView's event forwarding are all exercised.
/// Coordinates are window points with a top-left origin, as in a screenshot of the window.
///   click <x> <y> [count] [mods]            left click (count 2 = double click)
///   move <x> <y>
///   drag <x1> <y1> <x2> <y2> [mods]
///   scroll <x> <y> <dx> <dy> [mods] [wheel]  trackpad-style phased scroll (or a mouse wheel notch)
///   pinch <x> <y> <scale>                    trackpad magnify gesture, began/changed/ended
///   press <key> [mods]                       key down/up; key is a character or esc, return, tab,
///                                            delete, left, right, up, down, space, f
///   type <text>
@MainActor
enum DebugInput {
    static func run(_ cmd: String, _ arg: String, in w: NSWindow) async {
        let p = arg.split(separator: " ").map(String.init)
        func num(_ i: Int, _ d: Double = 0) -> Double { i < p.count ? Double(p[i]) ?? d : d }
        func mods(_ i: Int) -> NSEvent.ModifierFlags { i < p.count ? flags(p[i]) : [] }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        switch cmd {
        case "click":
            let count = max(1, Int(num(2, 1)))
            for n in 1...count {
                mouse(.leftMouseDown, num(0), num(1), w, mods(3), clicks: n)
                mouse(.leftMouseUp, num(0), num(1), w, mods(3), clicks: n)
                await pause(0.03)
            }
        case "move":
            mouse(.mouseMoved, num(0), num(1), w, [])
        case "drag":
            let (x1, y1, x2, y2) = (num(0), num(1), num(2), num(3))
            mouse(.leftMouseDown, x1, y1, w, mods(4))
            for i in 1...12 {
                let t = Double(i) / 12
                mouse(.leftMouseDragged, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w, mods(4))
                await pause(0.016)
            }
            mouse(.leftMouseUp, x2, y2, w, mods(4))
        case "scroll":
            let wheel = p.contains("wheel")
            let m = p.count > 4 && p[4] != "wheel" ? flags(p[4]) : []
            await scroll(num(0), num(1), num(2), num(3), w, m, wheel: wheel)
        case "pinch":
            await pinch(num(0), num(1), num(2, 1), w)
        case "press":
            key(p.first ?? "", mods(1), w)
        case "type":
            for ch in arg { key(String(ch), [], w); await pause(0.01) }
        default:
            break
        }
        await pause(0.05)
    }

    private static func pause(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }

    private static func flags(_ s: String) -> NSEvent.ModifierFlags {
        var f: NSEvent.ModifierFlags = []
        for m in s.split(separator: ",") {
            switch m {
            case "cmd": f.insert(.command)
            case "shift": f.insert(.shift)
            case "option", "alt": f.insert(.option)
            case "control", "ctrl": f.insert(.control)
            default: break
            }
        }
        return f
    }

    /// Window point (top-left origin of the frame, as in a window screenshot) → window base
    /// coordinates (bottom-left origin).
    private static func base(_ x: Double, _ y: Double, _ w: NSWindow) -> NSPoint {
        NSPoint(x: x, y: w.frame.height - y)
    }

    private static func mouse(_ type: NSEvent.EventType, _ x: Double, _ y: Double, _ w: NSWindow, _ f: NSEvent.ModifierFlags, clicks: Int = 1) {
        guard let e = NSEvent.mouseEvent(with: type, location: base(x, y, w), modifierFlags: f,
                                         timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: w.windowNumber,
                                         context: nil, eventNumber: 0, clickCount: type == .mouseMoved ? 0 : clicks,
                                         pressure: type == .leftMouseUp ? 0 : 1) else { return }
        // Keep the global cursor location consistent with the event for views that query it.
        let screen = w.convertPoint(toScreen: base(x, y, w))
        if let mainH = NSScreen.screens.first?.frame.height {
            CGWarpMouseCursorPosition(CGPoint(x: screen.x, y: mainH - screen.y))
        }
        NSApp.postEvent(e, atStart: false)
    }

    private static func cgLocation(_ x: Double, _ y: Double, _ w: NSWindow) -> CGPoint {
        let screen = w.convertPoint(toScreen: base(x, y, w))
        let mainH = NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: screen.x, y: mainH - screen.y)
    }

    private static func cgFlags(_ f: NSEvent.ModifierFlags) -> CGEventFlags {
        var c: CGEventFlags = []
        if f.contains(.command) { c.insert(.maskCommand) }
        if f.contains(.shift) { c.insert(.maskShift) }
        if f.contains(.option) { c.insert(.maskAlternate) }
        if f.contains(.control) { c.insert(.maskControl) }
        return c
    }

    /// Address a CGEvent to the window, as the window server does for events under the pointer:
    /// field 51 is the target window and the private CGEventSetWindowLocation sets the point in it
    /// (top-left origin). Without both, AppKit delivers the event to no window.
    private typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
    private static let setWindowLocation: SetWindowLocation? =
        dlsym(dlopen(nil, RTLD_NOW), "CGEventSetWindowLocation").map { unsafeBitCast($0, to: SetWindowLocation.self) }

    private static func target(_ e: CGEvent, _ w: NSWindow, _ x: Double, _ y: Double) {
        e.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(w.windowNumber))
        setWindowLocation?(e, CGPoint(x: x, y: y))
    }

    private static func scroll(_ x: Double, _ y: Double, _ dx: Double, _ dy: Double, _ w: NSWindow, _ f: NSEvent.ModifierFlags, wheel: Bool) async {
        let loc = cgLocation(x, y, w)
        CGWarpMouseCursorPosition(loc)
        func send(_ dx: Double, _ dy: Double, phase: Int64, continuous: Bool) {
            guard let e = CGEvent(scrollWheelEvent2Source: nil, units: continuous ? .pixel : .line, wheelCount: 2,
                                  wheel1: Int32(dy.rounded()), wheel2: Int32(dx.rounded()), wheel3: 0) else { return }
            e.location = loc
            e.flags = cgFlags(f)
            target(e, w, x, y)
            if continuous {
                e.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
                e.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: dy)
                e.setDoubleValueField(.scrollWheelEventPointDeltaAxis2, value: dx)
                e.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: dy)
                e.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis2, value: dx)
                e.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
            }
            guard let ns = NSEvent(cgEvent: e) else { return }
            NSApp.postEvent(ns, atStart: false)
        }
        if wheel {
            send(dx, dy, phase: 0, continuous: false)
            return
        }
        let steps = 10
        send(0, 0, phase: 1, continuous: true) // began (kCGScrollPhaseBegan)
        for _ in 0..<steps {
            send(dx / Double(steps), dy / Double(steps), phase: 2, continuous: true) // changed
            await pause(0.016)
        }
        send(0, 0, phase: 4, continuous: true) // ended
    }

    /// A trackpad magnify gesture: CGEvent type 29 (gesture) with the HID zoom subtype,
    /// which AppKit turns into NSEventTypeMagnify.
    private static func pinch(_ x: Double, _ y: Double, _ scale: Double, _ w: NSWindow) async {
        let loc = cgLocation(x, y, w)
        CGWarpMouseCursorPosition(loc)
        let steps = 12
        // Magnification deltas compound as (1 + m); split ln(scale) evenly.
        let per = pow(scale, 1 / Double(steps)) - 1
        func send(_ m: Double, phase: Int64) {
            guard let e = CGEvent(source: nil) else { return }
            e.type = CGEventType(rawValue: 29)!
            e.location = loc
            target(e, w, x, y)
            e.setIntegerValueField(CGEventField(rawValue: 110)!, value: 8) // kIOHIDEventTypeZoom
            e.setDoubleValueField(CGEventField(rawValue: 113)!, value: m)
            e.setIntegerValueField(CGEventField(rawValue: 132)!, value: phase) // 1 began, 2 changed, 4 ended
            guard let ns = NSEvent(cgEvent: e) else { return }
            NSApp.postEvent(ns, atStart: false)
        }
        send(0, phase: 1)
        for _ in 0..<steps {
            send(per, phase: 2)
            await pause(0.016)
        }
        send(0, phase: 4)
    }

    private static let keyCodes: [String: (UInt16, String)] = [
        "esc": (53, "\u{1b}"), "return": (36, "\r"), "tab": (48, "\t"), "delete": (51, "\u{7f}"),
        "space": (49, " "),
        "left": (123, String(UnicodeScalar(NSLeftArrowFunctionKey)!)), "right": (124, String(UnicodeScalar(NSRightArrowFunctionKey)!)),
        "down": (125, String(UnicodeScalar(NSDownArrowFunctionKey)!)), "up": (126, String(UnicodeScalar(NSUpArrowFunctionKey)!)),
    ]
    private static let charCodes: [Character: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
        "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
        "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50, " ": 49, "+": 24,
    ]

    private static func key(_ name: String, _ f: NSEvent.ModifierFlags, _ w: NSWindow) {
        var code: UInt16 = 0
        var chars = name
        if let k = keyCodes[name] {
            (code, chars) = k
        } else if let c = name.lowercased().first {
            code = charCodes[c] ?? 0
        }
        var f = f
        if (100...130).contains(Int(code)) { f.insert([.function, .numericPad]) }
        let ignoring = f.contains(.shift) ? chars.uppercased() : chars.lowercased()
        let typed = f.contains(.command) || f.contains(.control) ? chars.lowercased() : (f.contains(.shift) ? chars.uppercased() : chars)
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: f, timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: w.windowNumber, context: nil, characters: typed,
                                           charactersIgnoringModifiers: ignoring, isARepeat: false, keyCode: code) else { continue }
            NSApp.postEvent(e, atStart: false)
        }
    }
}
