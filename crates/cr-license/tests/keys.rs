//! Regression test: a key minted by `keygen --privkey <publisher private key>`
//! must verify against the PUBLIC_KEY embedded in this crate. If this fails,
//! the shipped binary rejects every minted key.

const MINTED_KEY: &str = "CR-Q1IxAc.nATjjH.dqbNlV.SP2353.0vv4iJ.zuvnJ8.gHx8JR.lcpyvr.sibCad.BkG7Xg.e_Bwzl.aZTjC9.tjFZU7.JTwWY3.6QMYOl.XQO97p.h2tjCQ";

#[test]
fn minted_key_verifies() {
    let info = cr_license::verify(MINTED_KEY).expect("minted key should verify");
    assert_eq!(info.key_id.len(), 16);
}

#[test]
fn minted_key_verifies_without_grouping() {
    let flat: String = MINTED_KEY.chars().filter(|c| *c != '.').collect();
    assert!(cr_license::verify(&flat).is_ok());
}

#[test]
fn tampered_key_rejected() {
    let mut bad = MINTED_KEY.to_string();
    let i = bad.len() - 2;
    bad.replace_range(i..i + 1, if bad.chars().nth(i) == Some('A') { "B" } else { "A" });
    assert!(cr_license::verify(&bad).is_err());
}
