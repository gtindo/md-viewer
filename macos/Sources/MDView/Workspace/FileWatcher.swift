import CoreServices
import Foundation

struct FileEvent: Sendable {
    let path: String
    let flags: FSEventStreamEventFlags

    var isStructural: Bool {
        let structural = kFSEventStreamEventFlagItemCreated | kFSEventStreamEventFlagItemRemoved
            | kFSEventStreamEventFlagItemRenamed | kFSEventStreamEventFlagMustScanSubDirs
            | kFSEventStreamEventFlagRootChanged | kFSEventStreamEventFlagUserDropped
            | kFSEventStreamEventFlagKernelDropped
        return flags & FSEventStreamEventFlags(structural) != 0
    }
}

/// One recursive FSEventStream for a workspace, with 100 ms coalescing (the stream latency).
@MainActor
final class FileWatcher {
    private var stream: FSEventStreamRef?
    private let handler: @MainActor ([FileEvent]) -> Void

    init(path: String, handler: @escaping @MainActor ([FileEvent]) -> Void) {
        self.handler = handler
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil, release: nil, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(
            kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagWatchRoot)
        let callback: FSEventStreamCallback = { _, info, count, paths, eventFlags, _ in
            guard let info else { return }
            let cfPaths = unsafeBitCast(paths, to: CFArray.self) as? [String] ?? []
            var events: [FileEvent] = []
            events.reserveCapacity(count)
            for i in 0..<min(count, cfPaths.count) {
                events.append(FileEvent(path: cfPaths[i], flags: eventFlags[i]))
            }
            // The stream is scheduled on the main queue.
            MainActor.assumeIsolated {
                let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
                watcher.handler(events)
            }
        }
        guard let s = FSEventStreamCreate(kCFAllocatorDefault, callback, &context, [path] as CFArray,
                                          FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.1, flags)
        else { return }
        stream = s
        FSEventStreamSetDispatchQueue(s, DispatchQueue.main)
        FSEventStreamStart(s)
    }

    func stop() {
        guard let s = stream else { return }
        FSEventStreamStop(s)
        FSEventStreamInvalidate(s)
        FSEventStreamRelease(s)
        stream = nil
    }
}
