import AppKit
import WebKit

/// Rasterises an SVG (which may contain foreignObject HTML labels) by rendering it in
/// an offscreen web view and snapshotting it.
@MainActor
final class SVGRasterizer: NSObject, WKNavigationDelegate {
    private var loaded: CheckedContinuation<Void, Never>?
    private static var active: Set<SVGRasterizer> = []

    static func png(svg: String, width: Double, height: Double, scale: Double = 2) async -> Data? {
        let r = SVGRasterizer()
        active.insert(r)
        defer { active.remove(r) }
        return await r.render(svg: svg, width: width, height: height, scale: scale)
    }

    private func render(svg: String, width: Double, height: Double, scale: Double) async -> Data? {
        let w = max(1, width), h = max(1, height)
        // Keep the bitmap within sane limits for huge diagrams.
        let maxSide = 16384.0, maxArea = 80_000_000.0
        var s = scale
        s = min(s, maxSide / w, maxSide / h, (maxArea / (w * h)).squareRoot())
        let pw = (w * s).rounded(), ph = (h * s).rounded()

        let config = WKWebViewConfiguration()
        config.preferences.inactiveSchedulingPolicy = .none
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: pw, height: ph), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        // The SVG is laid out at width×height CSS px; page zoom supplies the scale factor.
        web.pageZoom = s
        web.navigationDelegate = self
        let window = OffscreenWindow(size: NSSize(width: pw, height: ph))
        window.contentView = web
        defer { window.close() }

        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%}
        body>svg{display:block;width:\(w)px!important;height:\(h)px!important;max-width:none!important;max-height:none!important}
        </style></head><body>\(svg)</body></html>
        """
        await withCheckedContinuation { cont in
            loaded = cont
            web.loadHTMLString(html, baseURL: nil)
        }
        // Give layout (fonts, foreignObject) a frame to settle.
        _ = try? await web.evaluateJavaScript("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))")

        let snapConfig = WKSnapshotConfiguration()
        snapConfig.rect = web.bounds
        snapConfig.afterScreenUpdates = true
        guard let image = try? await web.takeSnapshot(configuration: snapConfig) else { return nil }
        return Self.pngData(image, pixelWidth: Int(pw), pixelHeight: Int(ph))
    }

    static func pngData(_ image: NSImage, pixelWidth: Int, pixelHeight: Int) -> Data? {
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: pixelWidth, pixelsHigh: pixelHeight, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        rep.size = NSSize(width: pixelWidth, height: pixelHeight)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        loaded?.resume()
        loaded = nil
    }
}

/// A borderless window placed off every screen, so web views get a real
/// window (and are painted) without anything appearing on screen.
final class OffscreenWindow: NSWindow {
    init(size: NSSize) {
        super.init(contentRect: NSRect(x: -30000, y: -30000, width: size.width, height: size.height),
                   styleMask: [.borderless], backing: .buffered, defer: false)
        isReleasedWhenClosed = false
        hasShadow = false
        ignoresMouseEvents = true
        collectionBehavior = [.transient, .ignoresCycle]
        orderBack(nil)
    }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
enum Clipboard {
    static let svgType = NSPasteboard.PasteboardType("public.svg-image")

    static func write(text: String?, pngBase64: String?, svg: String?, asPng: Bool, width: Double?, height: Double?) {
        if asPng, let svg {
            Task {
                guard let png = await SVGRasterizer.png(svg: svg, width: width ?? 800, height: height ?? 600) else {
                    return NSSound.beep()
                }
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setData(png, forType: .png)
            }
            return
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        if let svg {
            pb.setData(Data(svg.utf8), forType: svgType)
            pb.setString(svg, forType: .string)
        }
        if let pngBase64, let data = Data(base64Encoded: pngBase64) {
            pb.setData(data, forType: .png)
        }
        if let text, svg == nil {
            pb.setString(text, forType: .string)
        }
    }
}
