//! License key generator (not shipped with the app).
//!
//!   keygen init --out private-key.hex        # one-time: writes private key,
//!                                            # prints public key hex
//!   keygen mint --privkey private-key.hex --count 50 --out keys.txt
//!
//! The public key hex goes into `cr-license/src/lib.rs` PUBLIC_KEY. Keep the
//! private key outside the repository.

use cr_license::{format_key, make_payload};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use std::env;
use std::fs;
use std::process::exit;

fn hex_encode(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 {
        return Err(());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn usage() -> ! {
    eprintln!("usage:");
    eprintln!("  keygen init --out <private-key.hex>");
    eprintln!("  keygen mint --privkey <file> --count <n> --out <keys.txt>");
    exit(2);
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("init") => {
            let out = arg(&args, "--out").unwrap_or_else(|| "private-key.hex".into());
            let sk = SigningKey::generate(&mut OsRng);
            let vk: VerifyingKey = sk.verifying_key();
            fs::write(&out, hex_encode(&sk.to_bytes())).expect("write private key");
            println!("private key written to {out} — keep it safe and out of the repo");
            println!("public key (paste into cr-license/src/lib.rs PUBLIC_KEY):");
            println!("{}", hex_encode(&vk.to_bytes()));
        }
        Some("mint") => {
            let (Some(privfile), Some(count)) = (arg(&args, "--privkey"), arg(&args, "--count")) else {
                usage();
            };
            let out = arg(&args, "--out");
            let raw = fs::read_to_string(&privfile).expect("read private key");
            let bytes = hex_decode(raw.trim()).expect("private key is not hex");
            let sk = SigningKey::from_bytes(&bytes.try_into().expect("private key must be 32 bytes"));
            let n: usize = count.parse().expect("count must be a number");
            let mut lines = Vec::with_capacity(n);
            for _ in 0..n {
                let mut id = [0u8; 8];
                OsRng.fill_bytes(&mut id);
                let payload = make_payload(id);
                let sig = sk.sign(&payload);
                lines.push(format_key(&payload, &sig.to_bytes()));
            }
            let text = lines.join("\n") + "\n";
            match out {
                Some(path) => {
                    fs::write(&path, &text).expect("write keys");
                    println!("{n} keys written to {path}");
                }
                None => print!("{text}"),
            }
        }
        _ => usage(),
    }
}
