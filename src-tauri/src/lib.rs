// The application is entirely the static frontend staged into web-dist/ and embedded by Tauri.
// There is no Rust-side logic, so this only wires up the runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running OpenGantt");
}

