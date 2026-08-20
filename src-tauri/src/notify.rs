/// Best-effort Windows toast via PowerShell (no extra dependencies).
/// Fails silently if PowerShell/WinRT toast is unavailable.
pub fn toast(title: &str, body: &str) {
    if cfg!(not(target_os = "windows")) {
        return;
    }
    let title = title.replace('\'', "''");
    let body = body.replace('\'', "''");
    let script = format!(
        r#"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $t.GetElementsByTagName('text')
$texts.Item(0).AppendChild($t.CreateTextNode('{title}')) | Out-Null
$texts.Item(1).AppendChild($t.CreateTextNode('{body}')) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SpeedDownloader').Show([Windows.UI.Notifications.ToastNotification]::new($t))
"#
    );
    let tmp = std::env::temp_dir().join(format!("sd_toast_{}.ps1", std::process::id()));
    if std::fs::write(&tmp, &script).is_err() {
        return;
    }
    let _ = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&tmp)
        .spawn();
}
