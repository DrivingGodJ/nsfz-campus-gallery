import AppKit
import WebKit
import Foundation

enum LifecycleFailure: Error { case failed(String) }

@main
struct ReviewAppLifecycle {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = ReviewApp(resources: URL(fileURLWithPath: CommandLine.arguments[1]), servicePort: Int(CommandLine.arguments[2])!)
        app.delegate = delegate
        Task { @MainActor in
            do {
                let deadline = Date().addingTimeInterval(25)
                while delegate.serviceURL == nil {
                    guard Date() < deadline else { throw LifecycleFailure.failed(delegate.output) }
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                guard let service = delegate.service, let url = delegate.serviceURL, service.isRunning else { throw LifecycleFailure.failed("service not running") }
                let (_, response) = try await URLSession.shared.data(from: url)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw LifecycleFailure.failed("editor not reachable") }
                print("SERVICE_PID \(service.processIdentifier)"); fflush(stdout)
                while true {
                    let ready = try await delegate.webView.evaluateJavaScript("document.readyState === 'complete' && location.pathname === '/editor.html'")
                    if ready as? Bool == true { break }
                    guard Date() < deadline else { throw LifecycleFailure.failed("editor not loaded") }
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                _ = try await delegate.webView.evaluateJavaScript("window.reviewLifecycleMarker = 'preserved'")
                delegate.unsaved = true
                delegate.window.performClose(nil)
                guard !delegate.window.isVisible, service.isRunning, delegate.service === service, delegate.unsaved else { throw LifecycleFailure.failed("closing the window stopped the service or lost pending edits") }
                try await Task.sleep(nanoseconds: 200_000_000)
                print("WINDOW_CLOSED_SERVICE_ALIVE"); fflush(stdout)
                guard delegate.applicationShouldHandleReopen(app, hasVisibleWindows: false), delegate.window.isVisible,
                      delegate.service === service, service.isRunning else { throw LifecycleFailure.failed("reopen replaced the service") }
                let marker = try await delegate.webView.evaluateJavaScript("window.reviewLifecycleMarker")
                guard marker as? String == "preserved" else { throw LifecycleFailure.failed("reopen lost the editor state") }
                print("REOPENED_SAME_EDITOR_AND_SERVICE"); fflush(stdout)
                delegate.unsaved = false
                app.terminate(nil)
            } catch {
                fputs("LIFECYCLE_FAILED \(error)\n", stderr)
                delegate.unsaved = false; delegate.publishing = false
                if let group = delegate.serviceGroup { kill(-group, SIGKILL) }
                exit(1)
            }
        }
        withExtendedLifetime(delegate) { app.run() }
    }
}
