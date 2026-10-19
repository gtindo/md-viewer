import AppKit
import WebKit

func debugLog(_ message: @autoclosure () -> String) {
    guard ProcessInfo.processInfo.environment["MDVIEW_DEBUG"] != nil else { return }
    FileHandle.standardError.write(Data(("[mdview] " + message() + "\n").utf8))
}

/// Weak trampoline so WKUserContentController does not retain the controller.
private final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: DocumentController?

    init(target: DocumentController) { self.target = target }

    @MainActor
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.receive(message.body)
    }
}

/// WKWebView that lets the main menu's key equivalents win over web content.
final class MDWebView: WKWebView {
    /// Plain editing shortcuts stay with the web content so CodeMirror's own keymap handles them.
    private static let webFirstKeys: Set<String> = ["a", "c", "v", "x", "z"]

    var onFileDrop: (([URL]) -> Void)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        let plainEditing = (mods == .command || mods == [.command, .shift]) && Self.webFirstKeys.contains(key)
        if !plainEditing, window?.firstResponder === self || isDescendantFirstResponder,
           let menu = NSApp.mainMenu, menu.performKeyEquivalent(with: event) {
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    private var isDescendantFirstResponder: Bool {
        guard let r = window?.firstResponder as? NSView else { return false }
        return r.isDescendant(of: self)
    }

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        let blocked = ["Reload", "GoBack", "GoForward", "OpenLinkInNewWindow", "DownloadLinkedFile",
                       "OpenImageInNewWindow", "DownloadImage", "OpenFrameInNewWindow", "OpenMediaInNewWindow",
                       "DownloadMedia"]
        for item in menu.items {
            let id = item.identifier?.rawValue ?? ""
            if blocked.contains(where: { id.contains($0) }) { menu.removeItem(item) }
        }
        super.willOpenMenu(menu, with: event)
    }

    private func fileURLs(_ info: any NSDraggingInfo) -> [URL] {
        (info.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                                             options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingUpdated(sender) : .copy
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        if !urls.isEmpty, let onFileDrop { onFileDrop(urls); return true }
        return super.performDragOperation(sender)
    }
}

/// Owns one web view running the core, and the ordered message channel to it.
@MainActor
final class DocumentController: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: MDWebView
    private let schemeHandler: SchemeHandler
    private(set) var isReady = false
    private(set) var loadFailed = false
    private(set) var remoteImages = false
    private var readyWaiters: [CheckedContinuation<Bool, Never>] = []
    private var tail: Task<JSONValue?, Never>?
    private var loadedOnce = false

    var onMessage: ((CoreToHost) -> Void)?
    var onProcessTerminated: (() -> Void)?
    var lastUsed = Date()

    init(workspaceRoot: URL?, frame: NSRect = NSRect(x: 0, y: 0, width: 800, height: 600)) {
        schemeHandler = SchemeHandler(workspaceRoot: workspaceRoot)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: WebBundle.scheme)
        config.preferences.isElementFullscreenEnabled = false
        config.preferences.inactiveSchedulingPolicy = .none
        config.suppressesIncrementalRendering = false
        webView = MDWebView(frame: frame, configuration: config)
        super.init()
        config.userContentController.add(ScriptMessageProxy(target: self), name: "mdview")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true
        webView.underPageBackgroundColor = .textBackgroundColor
        webView.setValue(false, forKey: "drawsBackground")
        webView.onFileDrop = { urls in AppDelegate.shared?.open(urls: urls) }
    }

    func load(remoteImages: Bool = false) {
        self.remoteImages = remoteImages
        isReady = false
        loadFailed = false
        loadedOnce = true
        webView.load(URLRequest(url: WebBundle.indexURL(remoteImages: remoteImages)))
    }

    var hasLoaded: Bool { loadedOnce }

    // MARK: Messages from the core

    fileprivate func receive(_ body: Any) {
        guard let msg = CoreToHost.parse(body) else {
            debugLog("ignored message: \(body)")
            return
        }
        if case .ready(let version) = msg {
            if version != bridgeVersion { debugLog("core bridge version \(version), host \(bridgeVersion)") }
            isReady = true
            let waiters = readyWaiters
            readyWaiters.removeAll()
            waiters.forEach { $0.resume(returning: true) }
        }
        if case .log(let level, let message) = msg { debugLog("core \(level): \(message)") }
        onMessage?(msg)
    }

    // MARK: Messages to the core

    func waitReady() async -> Bool {
        if isReady { return true }
        if loadFailed { return false }
        return await withCheckedContinuation { readyWaiters.append($0) }
    }

    /// Queues a message; messages are delivered strictly in order, after `ready`.
    @discardableResult
    func enqueue(_ message: HostToCore) -> Task<JSONValue?, Never> {
        let previous = tail
        let task = Task { @MainActor [weak self] () -> JSONValue? in
            _ = await previous?.value
            guard let self, await self.waitReady() else { return nil }
            return await self.deliver(message)
        }
        tail = task
        return task
    }

    func send(_ message: HostToCore) async -> JSONValue? {
        await enqueue(message).value
    }

    private func deliver(_ message: HostToCore) async -> JSONValue? {
        do {
            let result = try await webView.callAsyncJavaScript(
                "return await window.mdview.receive(msg)",
                arguments: ["msg": message.dictionary()], in: nil, contentWorld: .page)
            return JSONValue(any: result)
        } catch {
            debugLog("\(message.typeName) failed: \(error.localizedDescription)")
            return nil
        }
    }

    func teardown() {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "mdview")
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        onMessage = nil
        onProcessTerminated = nil
        failWaiters()
    }

    private func failWaiters() {
        let waiters = readyWaiters
        readyWaiters.removeAll()
        waiters.forEach { $0.resume(returning: false) }
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == WebBundle.scheme, url.host == "app" {
            return decisionHandler(.allow)
        }
        if action.targetFrame?.isMainFrame == false, url.scheme == "about" {
            return decisionHandler(.allow)
        }
        decisionHandler(.cancel)
        if url.isFileURL {
            AppDelegate.shared?.open(urls: [url])
        } else if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""),
                  action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.setValue(true, forKey: "drawsBackground")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        debugLog("load failed: \(error.localizedDescription)")
        loadFailed = true
        failWaiters()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        debugLog("navigation failed: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        debugLog("web content process terminated")
        isReady = false
        if let onProcessTerminated { onProcessTerminated() } else { load(remoteImages: remoteImages) }
    }

    // MARK: WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}
