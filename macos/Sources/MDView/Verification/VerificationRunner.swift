import AppKit
import WebKit

struct TimeoutError: Error {}

@MainActor private final class Once { var done = false }

/// Runs `operation`, failing with TimeoutError after `seconds`.
@MainActor
func withTimeout<T: Sendable>(_ seconds: Double, _ operation: @escaping @MainActor () async throws -> T) async throws -> T {
    let once = Once()
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<T, Error>) in
        let task = Task { @MainActor in
            do {
                let value = try await operation()
                if !once.done { once.done = true; cont.resume(returning: value) }
            } catch {
                if !once.done { once.done = true; cont.resume(throwing: error) }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            MainActor.assumeIsolated {
                guard !once.done else { return }
                once.done = true
                task.cancel()
                cont.resume(throwing: TimeoutError())
            }
        }
    }
}

struct VerificationError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

enum VerificationJob {
    case renderCheck(folder: URL)
    case screenshot(file: URL, out: URL, width: Double, height: Double, dark: Bool, root: URL?, scroll: Double?)

    /// Parses `--render-check` / `--screenshot` arguments; nil when neither is present.
    static func parse(_ args: [String]) -> Result<VerificationJob, VerificationError>? {
        if let i = args.firstIndex(of: "--render-check") {
            guard i + 1 < args.count else { return .failure(VerificationError("usage: MDView --render-check <folder>")) }
            return .success(.renderCheck(folder: URL(fileURLWithPath: args[i + 1])))
        }
        guard let i = args.firstIndex(of: "--screenshot") else { return nil }
        let usage = "usage: MDView --screenshot <file.md> <out.png> [--width 1400] [--height 900] [--dark] [--root <dir>] [--scroll <y>]"
        guard i + 2 < args.count else { return .failure(VerificationError(usage)) }
        func value(_ flag: String) -> String? {
            guard let j = args.firstIndex(of: flag), j + 1 < args.count else { return nil }
            return args[j + 1]
        }
        return .success(.screenshot(
            file: URL(fileURLWithPath: args[i + 1]), out: URL(fileURLWithPath: args[i + 2]),
            width: value("--width").flatMap(Double.init) ?? 1400,
            height: value("--height").flatMap(Double.init) ?? 900,
            dark: args.contains("--dark"),
            root: value("--root").map { URL(fileURLWithPath: $0) },
            scroll: value("--scroll").flatMap(Double.init)))
    }
}

/// Headless app delegate for the verification modes: no visible windows, JSON on stdout.
@MainActor
final class VerificationRunner: NSObject, NSApplicationDelegate {
    let job: VerificationJob
    private var window: OffscreenWindow?

    init(job: VerificationJob) { self.job = job }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task {
            let code: Int32
            switch job {
            case .renderCheck(let folder): code = await renderCheck(folder)
            case let .screenshot(file, out, width, height, dark, root, scroll):
                code = await screenshot(file: file, out: out, width: width, height: height, dark: dark, root: root, scroll: scroll)
            }
            fflush(stdout)
            exit(code)
        }
    }

    /// Prints one JSON object per line with keys in the given order.
    private func emit(_ fields: [(String, any Encodable)]) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.withoutEscapingSlashes]
        let parts = fields.compactMap { key, value -> String? in
            guard let k = try? enc.encode(key), let v = try? enc.encode(value) else { return nil }
            return String(decoding: k, as: UTF8.self) + ":" + String(decoding: v, as: UTF8.self)
        }
        print("{" + parts.joined(separator: ",") + "}")
        fflush(stdout)
    }

    private func fail(_ message: String) -> Int32 {
        FileHandle.standardError.write(Data(("MDView: " + message + "\n").utf8))
        return 2
    }

    private func makeController(root: URL, size: NSSize, dark: Bool? = nil) -> DocumentController {
        window?.close()
        let w = OffscreenWindow(size: size)
        if let dark { w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua) }
        let c = DocumentController(workspaceRoot: root, frame: NSRect(origin: .zero, size: size))
        c.webView.frame = NSRect(origin: .zero, size: size)
        w.contentView = c.webView
        window = w
        c.load()
        return c
    }

    private func waitForCore(_ c: DocumentController, timeout: Double = 20) async -> Bool {
        (try? await withTimeout(timeout) { await c.waitReady() }) ?? false
    }

    private struct RenderStats: Sendable {
        var count: Int
        var errors: [DiagramError]
    }

    private func render(_ c: DocumentController, path: String, file: LoadedFile) async throws -> RenderStats {
        c.enqueue(.setSettings(CoreSettings()))
        _ = await c.send(.render(RenderPayload(path: path, text: file.text, editable: file.isUTF8,
                                                reason: "open", allowRemoteImages: false)))
        guard let result = await c.send(.renderAllDiagrams) else {
            throw VerificationError("renderAllDiagrams returned no result")
        }
        let count = Int(result["count"]?.number ?? 0)
        let errors = result["errors"]?.decode([DiagramError].self) ?? []
        return RenderStats(count: count, errors: errors)
    }

    // MARK: --render-check

    private func renderCheck(_ folder: URL) async -> Int32 {
        let root = folder.canonical
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir), isDir.boolValue else {
            return fail("not a folder: \(folder.path)")
        }
        let scan = TreeScanner.scan(root: root, options: ScanOptions(respectGitignore: true, extraGlobs: []))
        let size = NSSize(width: 1400, height: 900)
        var c = makeController(root: root, size: size)
        guard await waitForCore(c) else {
            return fail("the core did not become ready (web dir: \(WebBundle.directory.path))")
        }
        let start = Date()
        var totalDiagrams = 0, totalErrors = 0, failedFiles = 0
        for path in scan.markdownPaths {
            let t0 = Date()
            var diagrams = 0
            var errors: [DiagramError] = []
            switch FileService.read(root.appendingPathComponent(path)) {
            case .failure:
                errors = [DiagramError(key: "", message: "could not read file", line: nil)]
            case .success(let file):
                let controller = c
                do {
                    let stats = try await withTimeout(30) { try await self.render(controller, path: path, file: file) }
                    diagrams = stats.count
                    errors = stats.errors
                } catch is TimeoutError {
                    errors = [DiagramError(key: "", message: "timeout after 30 s", line: nil)]
                    c.teardown()
                    c = makeController(root: root, size: size)
                    _ = await waitForCore(c)
                } catch {
                    errors = [DiagramError(key: "", message: "\(error)", line: nil)]
                }
            }
            totalDiagrams += diagrams
            totalErrors += errors.count
            if !errors.isEmpty { failedFiles += 1 }
            emit([("path", path), ("diagrams", diagrams), ("errors", errors),
                  ("ms", Int(Date().timeIntervalSince(t0) * 1000))])
        }
        emit([("summary", true), ("files", scan.markdownPaths.count), ("diagrams", totalDiagrams),
              ("errors", totalErrors), ("failedFiles", failedFiles),
              ("ms", Int(Date().timeIntervalSince(start) * 1000))])
        c.teardown()
        return totalErrors > 0 ? 1 : 0
    }

    // MARK: --screenshot

    private func screenshot(file: URL, out: URL, width: Double, height: Double, dark: Bool,
                            root: URL?, scroll: Double?) async -> Int32 {
        let fileURL = file.canonical
        let rootURL = (root ?? fileURL.deletingLastPathComponent()).canonical
        guard fileURL.path.hasPrefix(rootURL.path + "/") else { return fail("\(file.path) is not inside \(rootURL.path)") }
        guard case .success(let loaded) = FileService.read(fileURL) else { return fail("cannot read \(file.path)") }
        let rel = String(fileURL.path.dropFirst(rootURL.path.count + 1))

        let c = makeController(root: rootURL, size: NSSize(width: width, height: height), dark: dark)
        guard await waitForCore(c) else {
            return fail("the core did not become ready (web dir: \(WebBundle.directory.path))")
        }
        c.enqueue(.setTheme(dark ? "dark" : "light"))
        do {
            let stats = try await withTimeout(30) { try await self.render(c, path: rel, file: loaded) }
            if !stats.errors.isEmpty {
                FileHandle.standardError.write(Data("MDView: \(stats.errors.count) diagram error(s)\n".utf8))
            }
        } catch {
            return fail("render failed: \(error)")
        }
        if let scroll {
            _ = await c.send(.restoreState(TabState(scrollY: scroll)))
        }
        _ = try? await c.webView.evaluateJavaScript(
            "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(1), 150))))")
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        guard let image = try? await c.webView.takeSnapshot(configuration: config),
              let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:])
        else { return fail("snapshot failed") }
        do {
            try png.write(to: out, options: .atomic)
        } catch {
            return fail("cannot write \(out.path): \(error.localizedDescription)")
        }
        print(out.path)
        c.teardown()
        return 0
    }
}
