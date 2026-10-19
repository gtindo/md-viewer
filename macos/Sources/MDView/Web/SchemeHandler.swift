import Foundation
import WebKit

enum WebBundle {
    /// Directory holding the built core (index.html etc.).
    static var directory: URL {
        if let override = ProcessInfo.processInfo.environment["MDVIEW_WEB_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override).standardizedFileURL
        }
        return (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("web").standardizedFileURL
    }

    static let scheme = "mdview"

    static func indexURL(remoteImages: Bool) -> URL {
        URL(string: remoteImages ? "mdview://app/index.html?remote=1" : "mdview://app/index.html")!
    }
}

/// Serves `mdview://app/<path>` from the bundled core and `mdview://ws/<path>` from the workspace.
@MainActor
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRoot: URL
    private let workspaceRoot: URL?

    init(workspaceRoot: URL?) {
        self.webRoot = WebBundle.directory.canonical
        self.workspaceRoot = workspaceRoot?.canonical
    }

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": "text/html; charset=utf-8"
        case "js", "mjs", "cjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json", "map": "application/json; charset=utf-8"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "avif": "image/avif"
        case "ico": "image/x-icon"
        case "bmp": "image/bmp"
        case "tif", "tiff": "image/tiff"
        case "woff2": "font/woff2"
        case "woff": "font/woff"
        case "ttf": "font/ttf"
        case "otf": "font/otf"
        case "wasm": "application/wasm"
        case "txt", "md", "markdown", "mdx": "text/plain; charset=utf-8"
        case "pdf": "application/pdf"
        case "mp4": "video/mp4"
        case "webm": "video/webm"
        case "mov": "video/quicktime"
        case "mp3": "audio/mpeg"
        default: "application/octet-stream"
        }
    }

    static func contentSecurityPolicy(remoteImages: Bool) -> String {
        let img = remoteImages ? "img-src mdview: data: blob: https: http:" : "img-src mdview: data: blob:"
        return "default-src mdview:; script-src mdview:; style-src mdview: 'unsafe-inline'; \(img); font-src mdview: data:; connect-src mdview:"
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return fail(task, status: 400) }
        switch url.host {
        case "app": serveApp(url, task)
        case "ws": serveWorkspace(url, task)
        default: fail(task, status: 404, url: url)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // Responses are produced synchronously; nothing to cancel.
    }

    private func serveApp(_ url: URL, _ task: any WKURLSchemeTask) {
        var rel = url.path
        while rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "index.html" }
        let file = webRoot.appendingPathComponent(rel).canonical
        guard file.path.hasPrefix(webRoot.path + "/") else { return fail(task, status: 403, url: url) }
        var headers: [String: String] = [:]
        if rel == "index.html" {
            let remote = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.contains { $0.name == "remote" && $0.value == "1" } ?? false
            headers["Content-Security-Policy"] = Self.contentSecurityPolicy(remoteImages: remote)
            headers["Cache-Control"] = "no-store"
        }
        serveFile(file, url: url, task, extraHeaders: headers)
    }

    private func serveWorkspace(_ url: URL, _ task: any WKURLSchemeTask) {
        guard let root = workspaceRoot else { return fail(task, status: 404, url: url) }
        // url.path is already percent-decoded.
        var rel = url.path
        while rel.hasPrefix("/") { rel.removeFirst() }
        let file = root.appendingPathComponent(rel).canonical
        guard file.path == root.path || file.path.hasPrefix(root.path + "/") else {
            return fail(task, status: 403, url: url)
        }
        serveFile(file, url: url, task, extraHeaders: [:])
    }

    private func serveFile(_ file: URL, url: URL, _ task: any WKURLSchemeTask, extraHeaders: [String: String]) {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue,
              let data = try? Data(contentsOf: file)
        else { return fail(task, status: 404, url: url) }
        var headers = extraHeaders
        headers["Content-Type"] = Self.mimeType(for: file.pathExtension)
        headers["Content-Length"] = String(data.count)
        headers["Access-Control-Allow-Origin"] = "*"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func fail(_ task: any WKURLSchemeTask, status: Int, url: URL? = nil) {
        let target = url ?? URL(string: "mdview://app/")!
        let response = HTTPURLResponse(url: target, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response)
        task.didReceive(Data())
        task.didFinish()
    }
}
