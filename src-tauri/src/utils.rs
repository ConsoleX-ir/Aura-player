// hash_str — byte-identical port of the renderer's hashStr from Aura 3.0
// (src/lib/utils.ts). The library's local track identity has been
// "hash of the file path" since 3.0, and keeping this exact algorithm (JS
// 32-bit signed semantics included) means the same file hashes to the same
// id across app versions and across the Electron→Tauri boundary. A test in
// db::tests pins a few known vectors against the original JS implementation.

pub fn hash_str(input: &str) -> String {
    let mut hash: i64 = 0;
    // JS charCodeAt iterates UTF-16 code units, not Unicode scalar values —
    // non-BMP characters (emoji, some CJK) occupy two units there.
    for unit in input.encode_utf16() {
        // JS: (hash << 5) - hash + charCode, then |0 (wrap to signed 32-bit).
        hash = (((hash << 5) - hash) + unit as i64) as i32 as i64;
        hash = hash as i32 as i64;
    }
    // Math.abs(i32::MIN) is 2^31 — fits in i64, then base-36 like
    // Number.prototype.toString(36).
    let magnitude = (hash as i32).unsigned_abs();
    to_base36(magnitude)
}

fn to_base36(mut value: u32) -> String {
    if value == 0 {
        return "0".to_string();
    }
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buf = [0u8; 7]; // u32::MAX in base 36 is 7 digits ("1z141z3")
    let mut len = 0;
    while value > 0 {
        buf[len] = DIGITS[(value % 36) as usize];
        value /= 36;
        len += 1;
    }
    buf[..len].iter().rev().map(|b| *b as char).collect()
}
