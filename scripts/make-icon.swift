#!/usr/bin/env swift
// Draws the MDView app icon with CoreGraphics and builds an .icns with iconutil.
// Usage: swift scripts/make-icon.swift [output.icns] [--preview preview.png]
//   (default output: macos/Resources/AppIcon.icns; --preview also writes a 1024 px PNG and,
//   next to it, a strip of the small sizes as they appear in Finder and the Dock)
//
// The motif: a markdown page carrying a small diagram in the app's diagram palette, and a lens
// magnifying part of it — readable diagrams are what the app is for.

import AppKit
import CoreGraphics
import Foundation

var args = Array(CommandLine.arguments.dropFirst())
var previewURL: URL?
if let i = args.firstIndex(of: "--preview"), i + 1 < args.count {
    previewURL = URL(fileURLWithPath: args[i + 1])
    args.removeSubrange(i...(i + 1))
}
let output = args.first.map { URL(fileURLWithPath: $0) }
    ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("macos/Resources/AppIcon.icns")

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

func gradient(_ stops: [(UInt32, CGFloat)], alpha: CGFloat = 1) -> CGGradient {
    CGGradient(colorsSpace: srgb, colors: stops.map { color($0.0, alpha) } as CFArray, locations: stops.map { $0.1 })!
}

// Diagram palette: the app's light diagram tones, a little stronger so they hold up small.
struct Tint { let fill: UInt32; let stroke: UInt32 }
let blue = Tint(fill: 0xE4EDFF, stroke: 0x6F98E6)
let amber = Tint(fill: 0xFFF0D2, stroke: 0xE0A93F)
let green = Tint(fill: 0xDDF6E7, stroke: 0x58BD86)
let violet = Tint(fill: 0xEDE6FF, stroke: 0x9A7FE3)
let connector: UInt32 = 0x9AA3B4

// MARK: Shapes

/// Shadow offsets and blur are in device pixels and ignore the CTM, so scale them with the
/// render size; otherwise small sizes get a smeared halo.
var renderScale: CGFloat = 1
func shadow(_ ctx: CGContext, _ dx: CGFloat, _ dy: CGFloat, _ blur: CGFloat, _ c: CGColor) {
    ctx.setShadow(offset: CGSize(width: dx * renderScale, height: dy * renderScale), blur: blur * renderScale, color: c)
}

func roundedRect(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

func fillStroke(_ ctx: CGContext, _ path: CGPath, _ t: Tint, width: CGFloat = 7) {
    ctx.addPath(path)
    ctx.setFillColor(color(t.fill))
    ctx.fillPath()
    ctx.addPath(path)
    ctx.setStrokeColor(color(t.stroke))
    ctx.setLineWidth(width)
    ctx.setLineJoin(.round)
    ctx.strokePath()
}

func polyline(_ ctx: CGContext, _ pts: [CGPoint], width: CGFloat = 8, hex: UInt32 = connector) {
    let p = CGMutablePath()
    p.addLines(between: pts)
    ctx.addPath(p)
    ctx.setStrokeColor(color(hex))
    ctx.setLineWidth(width)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
}

/// A connector ending in a small filled arrowhead, pointing along its last segment.
func arrow(_ ctx: CGContext, _ pts: [CGPoint]) {
    guard pts.count >= 2 else { return }
    let tip = pts[pts.count - 1], prev = pts[pts.count - 2]
    let len = max(1, hypot(tip.x - prev.x, tip.y - prev.y))
    let ux = (tip.x - prev.x) / len, uy = (tip.y - prev.y) / len
    var line = pts
    line[line.count - 1] = CGPoint(x: tip.x - ux * 16, y: tip.y - uy * 16)
    polyline(ctx, line)
    let back = CGPoint(x: tip.x - ux * 24, y: tip.y - uy * 24)
    let head = CGMutablePath()
    head.move(to: tip)
    head.addLine(to: CGPoint(x: back.x - uy * 15, y: back.y + ux * 15))
    head.addLine(to: CGPoint(x: back.x + uy * 15, y: back.y - ux * 15))
    head.closeSubpath()
    ctx.addPath(head)
    ctx.setFillColor(color(connector))
    ctx.fillPath()
}

/// The small diagram drawn on the page (y up).
func drawDiagram(_ ctx: CGContext) {
    // Connectors first, nodes on top.
    polyline(ctx, [CGPoint(x: 512, y: 598), CGPoint(x: 512, y: 548)])
    polyline(ctx, [CGPoint(x: 370, y: 548), CGPoint(x: 654, y: 548)])
    arrow(ctx, [CGPoint(x: 370, y: 548), CGPoint(x: 370, y: 528)])
    arrow(ctx, [CGPoint(x: 654, y: 548), CGPoint(x: 654, y: 497)])
    arrow(ctx, [CGPoint(x: 370, y: 382), CGPoint(x: 370, y: 262), CGPoint(x: 424, y: 262)])
    arrow(ctx, [CGPoint(x: 654, y: 413), CGPoint(x: 654, y: 262), CGPoint(x: 600, y: 262)])

    // Process: blue rounded rectangle.
    fillStroke(ctx, roundedRect(CGRect(x: 402, y: 598, width: 220, height: 86), 22), blue)
    // Decision: amber diamond.
    let d = CGMutablePath()
    d.move(to: CGPoint(x: 370, y: 528)); d.addLine(to: CGPoint(x: 444, y: 455))
    d.addLine(to: CGPoint(x: 370, y: 382)); d.addLine(to: CGPoint(x: 296, y: 455)); d.closeSubpath()
    fillStroke(ctx, d, amber)
    // Start/end: green stadium.
    fillStroke(ctx, roundedRect(CGRect(x: 556, y: 413, width: 196, height: 84), 42), green)
    // Database: violet cylinder.
    let cx: CGFloat = 512, w: CGFloat = 176, top: CGFloat = 322, bottom: CGFloat = 196, ry: CGFloat = 22
    let body = CGMutablePath()
    body.move(to: CGPoint(x: cx - w / 2, y: top))
    body.addLine(to: CGPoint(x: cx - w / 2, y: bottom))
    body.addEllipse(in: CGRect(x: cx - w / 2, y: bottom - ry, width: w, height: 2 * ry))
    body.addRect(CGRect(x: cx - w / 2, y: bottom, width: w, height: top - bottom))
    ctx.addPath(body)
    ctx.setFillColor(color(violet.fill))
    ctx.fillPath()
    let outline = CGMutablePath()
    outline.move(to: CGPoint(x: cx - w / 2, y: top))
    outline.addLine(to: CGPoint(x: cx - w / 2, y: bottom))
    outline.addArc(center: CGPoint(x: cx, y: bottom), radius: w / 2, startAngle: .pi, endAngle: 0, clockwise: false,
                   transform: CGAffineTransform(translationX: cx, y: bottom).scaledBy(x: 1, y: ry / (w / 2)).translatedBy(x: -cx, y: -bottom))
    outline.addLine(to: CGPoint(x: cx + w / 2, y: top))
    ctx.addPath(outline)
    ctx.setStrokeColor(color(violet.stroke))
    ctx.setLineWidth(7)
    ctx.strokePath()
    let lid = CGRect(x: cx - w / 2, y: top - ry, width: w, height: 2 * ry)
    ctx.setFillColor(color(0xF6F2FF))
    ctx.fillEllipse(in: lid)
    ctx.strokeEllipse(in: lid)

    // Node labels, as text-like bars (they become legible "text" under the lens).
    for (c, width, hex) in [(CGPoint(x: 512, y: 641), CGFloat(118), UInt32(0x8FAEE8)), (CGPoint(x: 370, y: 455), 60, 0xE7BD6C),
                            (CGPoint(x: 654, y: 455), 104, 0x7CCB9F), (CGPoint(x: 512, y: 250), 92, 0xB5A1EE)] {
        ctx.addPath(roundedRect(CGRect(x: c.x - width / 2, y: c.y - 8, width: width, height: 16), 8))
        ctx.setFillColor(color(hex))
        ctx.fillPath()
    }
}

/// The markdown mark "M↓", drawn as strokes so it stays crisp at every size.
func drawMarkdownMark(_ ctx: CGContext, origin: CGPoint, height h: CGFloat) {
    let w = h * 0.9
    let m = CGMutablePath()
    m.move(to: CGPoint(x: origin.x, y: origin.y))
    m.addLine(to: CGPoint(x: origin.x, y: origin.y + h))
    m.addLine(to: CGPoint(x: origin.x + w / 2, y: origin.y + h * 0.42))
    m.addLine(to: CGPoint(x: origin.x + w, y: origin.y + h))
    m.addLine(to: CGPoint(x: origin.x + w, y: origin.y))
    let ax = origin.x + w + h * 0.55
    m.move(to: CGPoint(x: ax, y: origin.y + h))
    m.addLine(to: CGPoint(x: ax, y: origin.y + h * 0.12))
    m.move(to: CGPoint(x: ax - h * 0.34, y: origin.y + h * 0.36))
    m.addLine(to: CGPoint(x: ax, y: origin.y + h * 0.02))
    m.addLine(to: CGPoint(x: ax + h * 0.34, y: origin.y + h * 0.36))
    ctx.addPath(m)
    ctx.setStrokeColor(color(0x2B3550))
    ctx.setLineWidth(h * 0.19)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
}

// MARK: Icon

/// Draws the icon on a 1024×1024 canvas (y up), on the macOS icon grid (824 pt body).
func drawIcon(_ ctx: CGContext) {
    let bodyRect = CGRect(x: 100, y: 100, width: 824, height: 824)
    let body = roundedRect(bodyRect, 186)

    // Body shadow, then a deep indigo gradient with a soft glow from the top.
    ctx.saveGState()
    shadow(ctx, 0, -10, 26, color(0x000000, 0.32))
    ctx.addPath(body)
    ctx.setFillColor(color(0x252C70))
    ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(body)
    ctx.clip()
    ctx.drawLinearGradient(gradient([(0x4657E0, 0), (0x3240B4, 0.5), (0x1E2463, 1)]),
                           start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    let glow = CGGradient(colorsSpace: srgb, colors: [color(0x9DB2FF, 0.38), color(0x9DB2FF, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 330, y: 900), startRadius: 0,
                           endCenter: CGPoint(x: 330, y: 900), endRadius: 620, options: [])
    ctx.restoreGState()

    // The page: white sheet with a folded top-right corner.
    let x0: CGFloat = 236, x1: CGFloat = 788, y0: CGFloat = 150, y1: CGFloat = 872, r: CGFloat = 44, fold: CGFloat = 128
    let page = CGMutablePath()
    page.move(to: CGPoint(x: x0 + r, y: y0))
    page.addLine(to: CGPoint(x: x1 - r, y: y0))
    page.addArc(tangent1End: CGPoint(x: x1, y: y0), tangent2End: CGPoint(x: x1, y: y0 + r), radius: r)
    page.addLine(to: CGPoint(x: x1, y: y1 - fold))
    page.addLine(to: CGPoint(x: x1 - fold, y: y1))
    page.addLine(to: CGPoint(x: x0 + r, y: y1))
    page.addArc(tangent1End: CGPoint(x: x0, y: y1), tangent2End: CGPoint(x: x0, y: y1 - r), radius: r)
    page.addLine(to: CGPoint(x: x0, y: y0 + r))
    page.addArc(tangent1End: CGPoint(x: x0, y: y0), tangent2End: CGPoint(x: x0 + r, y: y0), radius: r)
    page.closeSubpath()

    ctx.saveGState()
    shadow(ctx, 0, -14, 30, color(0x0A0E30, 0.45))
    ctx.addPath(page)
    ctx.setFillColor(color(0xFFFFFF))
    ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(page)
    ctx.clip()
    ctx.drawLinearGradient(gradient([(0xFFFFFF, 0), (0xF2F5FB, 1)]), start: CGPoint(x: 512, y: y1), end: CGPoint(x: 512, y: y0), options: [])
    ctx.restoreGState()

    // Folded corner.
    let foldPath = CGMutablePath()
    foldPath.move(to: CGPoint(x: x1 - fold, y: y1))
    foldPath.addLine(to: CGPoint(x: x1 - fold, y: y1 - fold + 22))
    foldPath.addQuadCurve(to: CGPoint(x: x1 - fold + 22, y: y1 - fold), control: CGPoint(x: x1 - fold, y: y1 - fold))
    foldPath.addLine(to: CGPoint(x: x1, y: y1 - fold))
    foldPath.closeSubpath()
    ctx.saveGState()
    shadow(ctx, -6, -6, 14, color(0x0A0E30, 0.22))
    ctx.addPath(foldPath)
    ctx.setFillColor(color(0xDCE2EE))
    ctx.fillPath()
    ctx.restoreGState()

    // Header: the markdown mark and two text lines.
    drawMarkdownMark(ctx, origin: CGPoint(x: 292, y: 758), height: 66)
    ctx.setFillColor(color(0xD6DCE7))
    ctx.addPath(roundedRect(CGRect(x: 452, y: 800, width: 176, height: 20), 10)); ctx.fillPath()
    ctx.addPath(roundedRect(CGRect(x: 452, y: 762, width: 128, height: 20), 10)); ctx.fillPath()

    drawDiagram(ctx)

    // The lens, magnifying the lower right of the diagram.
    let lensCenter = CGPoint(x: 648, y: 432), lensR: CGFloat = 132, ring: CGFloat = 26, zoom: CGFloat = 1.55

    // Handle (behind the ring), towards the bottom-right corner.
    let a = -CGFloat.pi / 4
    let hStart = CGPoint(x: lensCenter.x + cos(a) * (lensR + ring * 0.2), y: lensCenter.y + sin(a) * (lensR + ring * 0.2))
    let hEnd = CGPoint(x: lensCenter.x + cos(a) * (lensR + 128), y: lensCenter.y + sin(a) * (lensR + 128))
    ctx.saveGState()
    shadow(ctx, 0, -8, 18, color(0x05081F, 0.45))
    polyline(ctx, [hStart, hEnd], width: 54, hex: 0x1B2040)
    ctx.restoreGState()
    polyline(ctx, [hStart, hEnd], width: 40, hex: 0x343C66)

    // Glass: the diagram again, enlarged around the lens centre.
    ctx.saveGState()
    ctx.addEllipse(in: CGRect(x: lensCenter.x - lensR, y: lensCenter.y - lensR, width: 2 * lensR, height: 2 * lensR))
    ctx.clip()
    ctx.setFillColor(color(0xFFFFFF))
    ctx.fill(CGRect(x: lensCenter.x - lensR, y: lensCenter.y - lensR, width: 2 * lensR, height: 2 * lensR))
    ctx.translateBy(x: lensCenter.x, y: lensCenter.y)
    ctx.scaleBy(x: zoom, y: zoom)
    ctx.translateBy(x: -lensCenter.x, y: -lensCenter.y)
    drawDiagram(ctx)
    ctx.restoreGState()
    // Glass sheen.
    ctx.saveGState()
    ctx.addEllipse(in: CGRect(x: lensCenter.x - lensR, y: lensCenter.y - lensR, width: 2 * lensR, height: 2 * lensR))
    ctx.clip()
    let sheen = CGGradient(colorsSpace: srgb, colors: [color(0xFFFFFF, 0.5), color(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(sheen, startCenter: CGPoint(x: lensCenter.x - 70, y: lensCenter.y + 78), startRadius: 0,
                           endCenter: CGPoint(x: lensCenter.x - 70, y: lensCenter.y + 78), endRadius: 64, options: [])
    ctx.restoreGState()

    // Ring.
    ctx.saveGState()
    shadow(ctx, 0, -8, 18, color(0x05081F, 0.4))
    ctx.addEllipse(in: CGRect(x: lensCenter.x - lensR, y: lensCenter.y - lensR, width: 2 * lensR, height: 2 * lensR))
    ctx.setStrokeColor(color(0x343D74))
    ctx.setLineWidth(ring)
    ctx.strokePath()
    ctx.restoreGState()
    ctx.addEllipse(in: CGRect(x: lensCenter.x - lensR - ring * 0.18, y: lensCenter.y - lensR - ring * 0.18,
                              width: 2 * (lensR + ring * 0.18), height: 2 * (lensR + ring * 0.18)))
    ctx.setStrokeColor(color(0x5662A3))
    ctx.setLineWidth(ring * 0.36)
    ctx.strokePath()
    // Highlight along the top of the ring.
    ctx.addArc(center: lensCenter, radius: lensR, startAngle: .pi * 0.58, endAngle: .pi * 0.95, clockwise: false)
    ctx.setStrokeColor(color(0xFFFFFF, 0.35))
    ctx.setLineWidth(ring * 0.28)
    ctx.setLineCap(.round)
    ctx.strokePath()
}

func render(size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.setShouldAntialias(true)
    renderScale = CGFloat(size) / 1024
    ctx.scaleBy(x: renderScale, y: renderScale)
    drawIcon(ctx)
    return ctx.makeImage()!
}

func png(_ image: CGImage) -> Data {
    NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
}

if let previewURL {
    try png(render(size: 1024)).write(to: previewURL)
    // Small sizes side by side at 1× (16, 32, 64, 128) on a light and a dark strip.
    let sizes = [16, 32, 64, 128]
    let w = sizes.reduce(0, +) + 20 * (sizes.count + 1), h = (128 + 40) * 2
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    for (row, bg) in [(0, 0x1E1E20), (1, 0xF4F5F7)] as [(Int, UInt32)] {
        ctx.setFillColor(color(bg))
        ctx.fill(CGRect(x: 0, y: row * h / 2, width: w, height: h / 2))
        var x = 20
        for s in sizes {
            ctx.draw(render(size: s), in: CGRect(x: x, y: row * h / 2 + 20, width: s, height: s))
            x += s + 20
        }
    }
    let strip = previewURL.deletingPathExtension().appendingPathExtension("sizes.png")
    try png(ctx.makeImage()!).write(to: strip)
    print("wrote \(previewURL.path) and \(strip.path)")
    if args.isEmpty { exit(0) }
}

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("MDView-\(ProcessInfo.processInfo.processIdentifier).iconset")
try? fm.removeItem(at: iconset)
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try png(render(size: base)).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try png(render(size: base * 2)).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
try fm.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try task.run()
task.waitUntilExit()
try? fm.removeItem(at: iconset)
guard task.terminationStatus == 0 else {
    FileHandle.standardError.write(Data("iconutil failed\n".utf8))
    exit(1)
}
print("wrote \(output.path)")
