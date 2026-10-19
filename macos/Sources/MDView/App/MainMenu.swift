import AppKit

/// The menu bar. Workspace actions are nil-targeted and resolved through the
/// responder chain (WorkspaceWindowController); app-wide ones go to AppDelegate.
@MainActor
enum MainMenu {
    static func build(recentMenuDelegate: NSMenuDelegate) -> NSMenu {
        let main = NSMenu()
        main.addItem(submenu(appMenu()))
        main.addItem(submenu(fileMenu(recentMenuDelegate)))
        main.addItem(submenu(editMenu()))
        main.addItem(submenu(viewMenu()))
        main.addItem(submenu(goMenu()))
        let window = windowMenu()
        main.addItem(submenu(window))
        NSApp.windowsMenu = window
        let help = NSMenu(title: "Help")
        main.addItem(submenu(help))
        NSApp.helpMenu = help
        return main
    }

    private static func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }

    @discardableResult
    private static func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "",
                            _ mods: NSEvent.ModifierFlags = .command, tag: Int = 0) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        item.tag = tag
        menu.addItem(item)
        return item
    }

    private static func appMenu() -> NSMenu {
        let m = NSMenu(title: "MDView")
        add(m, "About MDView", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        m.addItem(.separator())
        add(m, "Settings…", #selector(AppDelegate.showSettings(_:)), ",")
        m.addItem(.separator())
        let services = NSMenu(title: "Services")
        let servicesItem = add(m, "Services", nil)
        servicesItem.submenu = services
        NSApp.servicesMenu = services
        m.addItem(.separator())
        add(m, "Hide MDView", #selector(NSApplication.hide(_:)), "h")
        add(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        add(m, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
        m.addItem(.separator())
        add(m, "Quit MDView", #selector(NSApplication.terminate(_:)), "q")
        return m
    }

    private static func fileMenu(_ recentDelegate: NSMenuDelegate) -> NSMenu {
        let m = NSMenu(title: "File")
        add(m, "New Window", #selector(AppDelegate.newWindow(_:)), "n")
        m.addItem(.separator())
        add(m, "Open Folder…", #selector(AppDelegate.openFolderPanel(_:)), "o")
        add(m, "Open File…", #selector(AppDelegate.openFilePanel(_:)), "o", [.command, .shift])
        let recent = NSMenu(title: "Open Recent")
        recent.delegate = recentDelegate
        add(m, "Open Recent", nil).submenu = recent
        add(m, "Quick Open…", #selector(WorkspaceWindowController.quickOpen(_:)), "p")
        m.addItem(.separator())
        add(m, "Save", #selector(WorkspaceWindowController.saveTab(_:)), "s")
        add(m, "Save As…", #selector(WorkspaceWindowController.saveTabAs(_:)), "s", [.command, .shift])
        m.addItem(.separator())
        add(m, "Close Tab", #selector(WorkspaceWindowController.closeTab(_:)), "w")
        add(m, "Reopen Closed Tab", #selector(WorkspaceWindowController.reopenClosedTab(_:)), "t", [.command, .shift])
        add(m, "Close Window", #selector(NSWindow.performClose(_:)), "w", [.command, .shift])
        return m
    }

    private static func editMenu() -> NSMenu {
        let m = NSMenu(title: "Edit")
        add(m, "Undo", Selector(("undo:")), "z")
        add(m, "Redo", Selector(("redo:")), "z", [.command, .shift])
        m.addItem(.separator())
        add(m, "Cut", #selector(NSText.cut(_:)), "x")
        add(m, "Copy", #selector(NSText.copy(_:)), "c")
        add(m, "Paste", #selector(NSText.paste(_:)), "v")
        add(m, "Select All", #selector(NSText.selectAll(_:)), "a")
        m.addItem(.separator())
        let find = NSMenu(title: "Find")
        add(find, "Find…", #selector(WorkspaceWindowController.findInDocument(_:)), "f")
        add(find, "Find Next", #selector(WorkspaceWindowController.findNextInDocument(_:)), "g")
        add(find, "Find Previous", #selector(WorkspaceWindowController.findPreviousInDocument(_:)), "g", [.command, .shift])
        add(find, "Replace…", #selector(WorkspaceWindowController.replaceInDocument(_:)), "f", [.command, .option])
        add(m, "Find", nil).submenu = find
        m.addItem(.separator())
        let format = NSMenu(title: "Format")
        add(format, "Bold", #selector(WorkspaceWindowController.formatBold(_:)), "b")
        add(format, "Italic", #selector(WorkspaceWindowController.formatItalic(_:)), "i")
        add(format, "Link", #selector(WorkspaceWindowController.formatLink(_:)), "k")
        add(m, "Format", nil).submenu = format
        return m
    }

    private static func viewMenu() -> NSMenu {
        let m = NSMenu(title: "View")
        for (i, mode) in Mode.allCases.enumerated() {
            add(m, mode.label, #selector(WorkspaceWindowController.setModeFromMenu(_:)), tag: i)
        }
        add(m, "Toggle Preview / Edit", #selector(WorkspaceWindowController.toggleEditMode(_:)), "e")
        add(m, "Cycle Modes", #selector(WorkspaceWindowController.cycleModes(_:)), "p", [.command, .shift])
        m.addItem(.separator())
        add(m, "Toggle Sidebar", #selector(NSSplitViewController.toggleSidebar(_:)), "s", [.command, .control])
        add(m, "Reveal in Tree", #selector(WorkspaceWindowController.revealInTree(_:)), "j", [.command, .shift])
        m.addItem(.separator())
        let width = NSMenu(title: "Content Width")
        for (i, w) in WidthMode.allCases.enumerated() {
            add(width, w.label, #selector(WorkspaceWindowController.setContentWidth(_:)), tag: i)
        }
        add(m, "Content Width", nil).submenu = width
        add(m, "Zoom In", #selector(AppDelegate.zoomInText(_:)), "+")
        let alt = add(m, "Zoom In", #selector(AppDelegate.zoomInText(_:)), "=")
        alt.isHidden = true
        alt.allowsKeyEquivalentWhenHidden = true
        add(m, "Zoom Out", #selector(AppDelegate.zoomOutText(_:)), "-")
        add(m, "Actual Size", #selector(AppDelegate.actualSizeText(_:)), "0")
        m.addItem(.separator())
        add(m, "Expand Focused Diagram", #selector(WorkspaceWindowController.expandFocusedDiagram(_:)), "\r")
        add(m, "Next Diagram", #selector(WorkspaceWindowController.nextDiagram(_:)),
            String(UnicodeScalar(NSRightArrowFunctionKey)!), [.command, .option])
        add(m, "Previous Diagram", #selector(WorkspaceWindowController.previousDiagram(_:)),
            String(UnicodeScalar(NSLeftArrowFunctionKey)!), [.command, .option])
        m.addItem(.separator())
        add(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        return m
    }

    private static func goMenu() -> NSMenu {
        let m = NSMenu(title: "Go")
        add(m, "Back", #selector(WorkspaceWindowController.goBackInTab(_:)), "[")
        add(m, "Forward", #selector(WorkspaceWindowController.goForwardInTab(_:)), "]")
        m.addItem(.separator())
        add(m, "Next Tab", #selector(WorkspaceWindowController.nextTab(_:)), "\t", .control)
        add(m, "Previous Tab", #selector(WorkspaceWindowController.previousTab(_:)), "\t", [.control, .shift])
        m.addItem(.separator())
        for n in 1...9 {
            add(m, n == 9 ? "Last Tab" : "Tab \(n)", #selector(WorkspaceWindowController.selectTabNumber(_:)), "\(n)", tag: n)
        }
        return m
    }

    private static func windowMenu() -> NSMenu {
        let m = NSMenu(title: "Window")
        add(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(m, "Zoom", #selector(NSWindow.performZoom(_:)))
        m.addItem(.separator())
        add(m, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
        return m
    }
}
