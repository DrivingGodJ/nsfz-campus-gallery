import AppKit
import WebKit
import UniformTypeIdentifiers
import Darwin

@MainActor
final class ReviewApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let resources: URL?
    let servicePort: Int
    var window: NSWindow!
    var webView: WKWebView!
    var service: Process?
    var publishing = false
    var unsaved = false
    var root = ""
    var serviceURL: URL?
    var output = ""
    var launching = false
    var restartRequested = false
    var quitting = false
    var serviceLifetime: Pipe?
    var serviceOutput: Pipe?
    var serviceGroup: pid_t?

    init(resources: URL? = Bundle.main.resourceURL, servicePort: Int = 5188) {
        self.resources = resources
        self.servicePort = servicePort
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "reviewApp")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "附中影像审核"
        window.minSize = NSSize(width: 960, height: 640)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("CampusReviewWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if let saved = UserDefaults.standard.string(forKey: "contentRoot") { root = saved }
        else if let file = resources?.appendingPathComponent("project.json"),
                let data = try? Data(contentsOf: file), let json = try? JSONSerialization.jsonObject(with: data) as? [String: String] { root = json["root"] ?? "" }
        if FileManager.default.fileExists(atPath: root + "/server/local-editor.mjs") { startService() }
        else { showStartup("请选择附中影像内容库", detail: "内容库保存你的照片、标注和网站文件。第一次使用时选择 nsfz-campus-gallery 文件夹。", failed: true) }
    }

    func buildMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem(); bar.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于附中影像审核", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏附中影像审核", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出附中影像审核", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = NSMenuItem(); bar.addItem(file); file.submenu = NSMenu(title: "文件")
        file.submenu?.addItem(withTitle: "导入照片或审核包…", action: #selector(importPhotos), keyEquivalent: "o")
        let publish = file.submenu!.addItem(withTitle: "上线…", action: #selector(openPublication), keyEquivalent: "p"); publish.keyEquivalentModifierMask = [.command, .shift]
        file.submenu?.addItem(.separator())
        file.submenu?.addItem(withTitle: "打开内容库文件夹", action: #selector(revealRoot), keyEquivalent: "")
        file.submenu?.addItem(withTitle: "选择内容库…", action: #selector(chooseRoot), keyEquivalent: "")
        let edit = NSMenuItem(); bar.addItem(edit); edit.submenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("拷贝", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] { edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        let view = NSMenuItem(); bar.addItem(view); view.submenu = NSMenu(title: "窗口")
        view.submenu?.addItem(withTitle: "重新连接审核器", action: #selector(reload), keyEquivalent: "r")
        view.submenu?.addItem(withTitle: "打开线上网站", action: #selector(openWebsite), keyEquivalent: "")
        NSApp.mainMenu = bar
    }

    func showStartup(_ title: String, detail: String, failed: Bool = false) {
        let escape: (String) -> String = { $0.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
        webView.loadHTMLString("""
        <!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{background:#f8f8f2;color:#344f3e;font:15px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;height:95vh;margin:0}main{max-width:520px;padding:36px}h1{font-size:25px}p{line-height:1.9;color:#6b755f;white-space:pre-wrap}button{padding:12px 18px;border:0;border-radius:8px;background:#344f3e;color:white;font:inherit;cursor:pointer;margin-right:10px}</style><main><h1>\(escape(title))</h1><p>\(escape(detail))</p>\(failed ? "<button onclick=\"webkit.messageHandlers.reviewApp.postMessage({type:'chooseRoot'})\">选择内容库</button><button onclick=\"webkit.messageHandlers.reviewApp.postMessage({type:'retry'})\">重试打开</button>" : "")</main></html>
        """, baseURL: nil)
    }

    func startService() {
        guard !launching, !quitting else { return }
        if let current = service, current.isRunning {
            launching = true; restartRequested = true
            showStartup("正在连接内容库", detail: "正在关闭上一连接并打开新的内容库…")
            stopService(current)
            return
        }
        launching = true; output = ""; serviceURL = nil
        showStartup("正在打开附中影像审核", detail: "正在连接本地内容库…\n照片和审核记录保存在这台电脑。")
        let process = Process()
        guard let resources = resources else { launching = false; return }
        process.executableURL = resources.appendingPathComponent("runtime/bin/node")
        process.arguments = [resources.appendingPathComponent("bootstrap.mjs").path, root]
        process.currentDirectoryURL = URL(fileURLWithPath: root)
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = resources.appendingPathComponent("runtime/bin").path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        environment["CAMPUS_NPM_CLI"] = resources.appendingPathComponent("runtime/lib/node_modules/npm/bin/npm-cli.js").path
        environment["CAMPUS_DESKTOP_APP"] = "1"
        environment["CAMPUS_REVIEW_PORT"] = String(servicePort)
        process.environment = environment
        // EOF also stops the service if the app crashes or is force-quit.
        let lifetime = Pipe(); process.standardInput = lifetime
        serviceLifetime = lifetime
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        serviceOutput = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.receive(text) }
        }
        process.terminationHandler = { [weak self] task in
            // Quit waits in AppKit's modal run loop. A main-queue callback can
            // be blocked by that wait, so deliver completion in its run modes.
            RunLoop.main.perform(inModes: [.default, .modalPanel, .eventTracking]) {
                MainActor.assumeIsolated {
                    guard let self = self, self.service === task else { return }
                    self.finishService(task)
                }
            }
        }
        service = process
        do {
            try process.run()
            // Foundation gives this child its own group. Never signal the app's
            // group or another service if that launch behavior changes.
            let group = getpgid(process.processIdentifier)
            serviceGroup = group == process.processIdentifier ? group : nil
            try? lifetime.fileHandleForReading.close()
            try? pipe.fileHandleForWriting.close()
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
                guard let self = self, !self.quitting, self.service === process, self.serviceURL == nil, process.isRunning else { return }
                self.showStartup("正在等待内容库访问", detail: "如果 macOS 询问访问文稿或下载文件夹，请点击“允许”。\n也可在“系统设置 → 隐私与安全性 → 文件与文件夹”中允许附中影像审核访问文稿，然后点“重试打开”。", failed: true)
            }
        }
        catch {
            service = nil; serviceGroup = nil; launching = false
            closeServicePipes()
            showStartup("审核器未能打开", detail: error.localizedDescription, failed: true)
        }
    }

    func closeServicePipes() {
        try? serviceLifetime?.fileHandleForWriting.close()
        try? serviceLifetime?.fileHandleForReading.close()
        serviceLifetime = nil
        serviceOutput?.fileHandleForReading.readabilityHandler = nil
        try? serviceOutput?.fileHandleForReading.close()
        try? serviceOutput?.fileHandleForWriting.close()
        serviceOutput = nil
    }

    func stopService(_ process: Process) {
        if let lifetime = serviceLifetime { try? lifetime.fileHandleForWriting.close() }
        else if process.isRunning { process.terminate() }
        // Give Vite time to close its watcher, sockets and local database worker.
        afterServiceDelay(8) { [weak self] in
            guard let self = self, self.service === process, process.isRunning else { return }
            if let group = self.serviceGroup { kill(-group, SIGKILL) }
            else { kill(process.processIdentifier, SIGKILL) }
        }
    }

    func finishService(_ process: Process, attempts: Int = 0) {
        guard service === process else { return }
        // Publishing commands share the owned group and may outlive Node.
        // Wait for them too before quitting or reconnecting to another library.
        if let group = serviceGroup, kill(-group, 0) == 0 {
            kill(-group, attempts < 20 ? SIGTERM : SIGKILL)
            if attempts < 40 {
                afterServiceDelay(0.05) { [weak self] in
                    self?.finishService(process, attempts: attempts + 1)
                }
                return
            }
        }
        closeServicePipes()
        launching = false; service = nil; serviceGroup = nil; serviceURL = nil
        if quitting { NSApp.reply(toApplicationShouldTerminate: true); return }
        if restartRequested { restartRequested = false; startService(); return }
        if process.terminationStatus != 0 { showStartup("审核器未能打开", detail: output.suffix(1800).description + "\n\n请确认内容库仍在原位置，或重新选择内容库。", failed: true) }
    }

    func afterServiceDelay(_ interval: TimeInterval, _ action: @escaping @MainActor () -> Void) {
        let timer = Timer(timeInterval: interval, repeats: false) { _ in MainActor.assumeIsolated { action() } }
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.add(timer, forMode: .modalPanel)
    }

    func receive(_ text: String) {
        output = String((output + text).suffix(12000))
        guard serviceURL == nil, !quitting, !restartRequested else { return }
        for line in output.components(separatedBy: "\n") where line.hasPrefix("REVIEW_APP_READY ") {
            if let data = line.dropFirst(17).data(using: .utf8), let info = try? JSONSerialization.jsonObject(with: data) as? [String: String], let value = info["url"], let url = URL(string: value), url.host == "127.0.0.1", url.port == servicePort {
                serviceURL = url; launching = false
                UserDefaults.standard.set(root, forKey: "contentRoot")
                webView.load(URLRequest(url: url))
            }
        }
    }

    @objc func importPhotos() { webView.evaluateJavaScript("document.querySelector('input[type=file]')?.click()") }
    @objc func openPublication() { webView.evaluateJavaScript("window.dispatchEvent(new Event('review-app-publish'))") }
    @objc func revealRoot() { NSWorkspace.shared.open(URL(fileURLWithPath: root)) }
    @objc func openWebsite() { NSWorkspace.shared.open(URL(string: "https://drivinggodj.github.io/nsfz-campus-gallery/")!) }
    @objc func reload() { if service?.isRunning == true { webView.reload() } else { startService() } }
    @objc func about() { let alert = NSAlert(); alert.messageText = "附中影像审核"; alert.informativeText = "导入照片和投稿包，核对位置与视角，再发布到附中影像网站。\n原片和待审核草稿保留在本地内容库。"; alert.runModal() }
    @objc func chooseRoot() {
        guard !publishing else { return }
        let panel = NSOpenPanel(); panel.title = "选择附中影像内容库"; panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self = self, result == .OK, let url = panel.url else { return }
            guard FileManager.default.fileExists(atPath: url.appendingPathComponent("server/local-editor.mjs").path) else { self.showStartup("无法读取这个内容库", detail: "已选择：" + url.path + "\n\n请选择 nsfz-campus-gallery 项目文件夹，并允许应用访问文件夹。", failed: true); return }
            self.root = url.path; self.startService()
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let value = message.body as? [String: Any], let type = value["type"] as? String else { return }
        if type == "publishing" { publishing = value["value"] as? Bool ?? false }
        else if type == "unsaved" { unsaved = value["value"] as? Bool ?? false }
        else if type == "chooseRoot" { chooseRoot() }
        else if type == "retry" { startService() }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.title = "导入自己的照片或投稿审核包"; panel.prompt = "导入"; panel.canChooseDirectories = false; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.image, .zip]
        if let saved = UserDefaults.standard.string(forKey: "lastImportDirectory") { panel.directoryURL = URL(fileURLWithPath: saved) }
        else { panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first }
        panel.beginSheetModal(for: window) { result in
            if result == .OK, let first = panel.urls.first { UserDefaults.standard.set(first.deletingLastPathComponent().path, forKey: "lastImportDirectory") }
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.host == "127.0.0.1" && url.port == servicePort) { decisionHandler(.allow) }
        else { if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateLater }
        if publishing || unsaved {
            let alert = NSAlert(); alert.messageText = publishing ? "网站正在上线" : "照片还有未保存的修改"
            alert.informativeText = publishing ? "建议等待上线完成。现在退出会中断本地任务，已保存内容仍会保留。" : "修改已暂存在应用里。保存到内容库后，才能发布到网站。"
            alert.addButton(withTitle: publishing ? "继续等待" : "继续编辑"); alert.addButton(withTitle: "退出应用")
            if alert.runModal() == .alertFirstButtonReturn { return .terminateCancel }
        }
        guard let current = service else { return .terminateNow }
        quitting = true; restartRequested = false
        stopService(current)
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        try? serviceLifetime?.fileHandleForWriting.close()
        if let group = serviceGroup { kill(-group, SIGTERM) }
        else if service?.isRunning == true { service?.terminate() }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !quitting else { return false }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }
}

#if !REVIEW_APP_TESTING
@main
struct Main {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = ReviewApp(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
#endif
