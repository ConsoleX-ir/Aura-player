fn main() {
    let paths = vec!["/music/test.mp3", "/home/user/Música/Café - Track01.flac", "D:\\Music\\emoji 🎵 song.mp3", "/tmp/a", "x"];
    let out: Vec<String> = paths.iter().map(|p| aura_lib::utils::hash_str(p)).collect();
    println!("{:?}", out);
}
