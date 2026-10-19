import AppKit

let arguments = Array(CommandLine.arguments.dropFirst())
let app = NSApplication.shared

MainActor.assumeIsolated {
    switch VerificationJob.parse(arguments) {
    case .failure(let error)?:
        FileHandle.standardError.write(Data((error.description + "\n").utf8))
        exit(2)
    case .success(let job)?:
        app.setActivationPolicy(.prohibited)
        let runner = VerificationRunner(job: job)
        app.delegate = runner
        app.run()
        withExtendedLifetime(runner) {}
    case nil:
        let delegate = AppDelegate()
        // Folder or file paths given on the command line; ignore AppKit/Xcode flags such as -NSDocumentRevisionsDebugMode YES.
        var paths: [URL] = []
        var skipNext = false
        for arg in arguments {
            if skipNext { skipNext = false; continue }
            if arg.hasPrefix("-psn_") { continue }
            if arg.hasPrefix("-") { skipNext = true; continue }
            let url = URL(fileURLWithPath: arg)
            if FileManager.default.fileExists(atPath: url.path) { paths.append(url) }
        }
        delegate.launchPaths = paths
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
