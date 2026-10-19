#!/usr/bin/env swift
// Draws the MDView app icon with CoreGraphics and builds an .icns with iconutil.
// Usage: swift scripts/make-icon.swift [output.icns]   (default: macos/Resources/AppIcon.icns)

import AppKit
import CoreGraphics
import Foundation

let output = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1])
    : URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("macos/Resources/AppIcon.icns")

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

/// Draws the icon on a 1024×1024 canvas (y up).
func drawIcon(_ ctx: CGContext) {
    // macOS icon grid: 824 pt body centred in 1024, continuous-corner radius ≈ 185.
    let body = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

    // Drop shadow.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.35))
    ctx.addPath(shape)
    ctx.setFillColor(color(0x1E2A5A))
    ctx.fillPath()
    ctx.restoreGState()

    // Background gradient: deep indigo to teal.
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let bg = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                        colors: [color(0x2B2F77), color(0x3A4FC4), color(0x13A3B5)] as CFArray,
                        locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: 180, y: 940), end: CGPoint(x: 860, y: 90), options: [])
    // Soft top highlight.
    let hl = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                        colors: [color(0xFFFFFF, 0.18), color(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(hl, startCenter: CGPoint(x: 340, y: 900), startRadius: 0,
                           endCenter: CGPoint(x: 340, y: 900), endRadius: 620, options: [])
    // Faint grid, like a diagram canvas.
    ctx.setStrokeColor(color(0xFFFFFF, 0.06))
    ctx.setLineWidth(3)
    for i in stride(from: 100, through: 924, by: 64) {
        ctx.move(to: CGPoint(x: CGFloat(i), y: 100)); ctx.addLine(to: CGPoint(x: CGFloat(i), y: 924))
        ctx.move(to: CGPoint(x: 100, y: CGFloat(i))); ctx.addLine(to: CGPoint(x: 924, y: CGFloat(i)))
    }
    ctx.strokePath()
    ctx.restoreGState()

    let node = color(0xFFFFFF, 0.96)

    // Connectors.
    ctx.saveGState()
    ctx.setStrokeColor(color(0xFFFFFF, 0.9))
    ctx.setLineWidth(22)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    let top = CGPoint(x: 512, y: 640)
    ctx.move(to: CGPoint(x: top.x, y: top.y - 70))
    ctx.addLine(to: CGPoint(x: top.x, y: 500))
    ctx.move(to: CGPoint(x: 300, y: 500)); ctx.addLine(to: CGPoint(x: 724, y: 500))
    ctx.move(to: CGPoint(x: 300, y: 500)); ctx.addLine(to: CGPoint(x: 300, y: 420))
    ctx.move(to: CGPoint(x: 724, y: 500)); ctx.addLine(to: CGPoint(x: 724, y: 420))
    ctx.strokePath()
    ctx.restoreGState()

    // Top node: a markdown "card" with an M and a down arrow.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: color(0x000000, 0.25))
    let card = CGRect(x: 332, y: 570, width: 360, height: 210)
    ctx.addPath(CGPath(roundedRect: card, cornerWidth: 44, cornerHeight: 44, transform: nil))
    ctx.setFillColor(node)
    ctx.fillPath()
    ctx.restoreGState()

    let ink = color(0x2B3A8F)
    ctx.saveGState()
    ctx.setStrokeColor(ink)
    ctx.setLineWidth(30)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    // "M"
    ctx.move(to: CGPoint(x: 392, y: 620))
    ctx.addLine(to: CGPoint(x: 392, y: 730))
    ctx.addLine(to: CGPoint(x: 452, y: 664))
    ctx.addLine(to: CGPoint(x: 512, y: 730))
    ctx.addLine(to: CGPoint(x: 512, y: 620))
    // "↓"
    ctx.move(to: CGPoint(x: 612, y: 730)); ctx.addLine(to: CGPoint(x: 612, y: 624))
    ctx.move(to: CGPoint(x: 572, y: 664)); ctx.addLine(to: CGPoint(x: 612, y: 622)); ctx.addLine(to: CGPoint(x: 652, y: 664))
    ctx.strokePath()
    ctx.restoreGState()

    // Bottom-left: decision diamond. Bottom-right: rounded process node.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: color(0x000000, 0.25))
    ctx.setFillColor(node)
    let d = CGMutablePath()
    d.move(to: CGPoint(x: 300, y: 430)); d.addLine(to: CGPoint(x: 400, y: 330))
    d.addLine(to: CGPoint(x: 300, y: 230)); d.addLine(to: CGPoint(x: 200, y: 330)); d.closeSubpath()
    ctx.addPath(d)
    ctx.fillPath()
    let p = CGRect(x: 614, y: 260, width: 220, height: 150)
    ctx.addPath(CGPath(roundedRect: p, cornerWidth: 75, cornerHeight: 75, transform: nil))
    ctx.fillPath()
    ctx.restoreGState()

    // Accent dots inside the lower nodes.
    ctx.setFillColor(color(0x13A3B5))
    ctx.fillEllipse(in: CGRect(x: 276, y: 306, width: 48, height: 48))
    ctx.setFillColor(color(0x3A4FC4))
    ctx.fillEllipse(in: CGRect(x: 700, y: 311, width: 48, height: 48))
}

func render(size: Int) -> Data {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.setShouldAntialias(true)
    ctx.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    drawIcon(ctx)
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    return rep.representation(using: .png, properties: [:])!
}

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("MDView-\(ProcessInfo.processInfo.processIdentifier).iconset")
try? fm.removeItem(at: iconset)
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try render(size: base).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try render(size: base * 2).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
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
