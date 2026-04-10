use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub admin_key: String,
    pub db_path: PathBuf,
    pub invidious_instances: Vec<String>,
    pub piped_instances: Vec<String>,
    pub yt_dlp_commands: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(3000);

        let admin_key = env::var("ADMIN_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "admin_change_me".to_string());

        let db_path = env::var("INSECT_RS_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/keys.sqlite"));

        Self {
            port,
            admin_key,
            db_path,
            invidious_instances: parse_csv_env("INSECT_INVIDIOUS_INSTANCES").unwrap_or_else(|| {
                vec![
                    "https://invidious.nerdvpn.de".to_string(),
                    "https://invidious.protokolla.fi".to_string(),
                    "https://yewtu.be".to_string(),
                ]
            }),
            piped_instances: parse_csv_env("INSECT_PIPED_INSTANCES").unwrap_or_else(|| {
                vec![
                    "https://pipedapi.kavin.rocks".to_string(),
                    "https://pipedapi.adminforge.de".to_string(),
                    "https://pipedapi.aeong.one".to_string(),
                ]
            }),
            yt_dlp_commands: parse_csv_env("INSECT_YTDLP_COMMANDS")
                .unwrap_or_else(|| vec!["yt-dlp".to_string(), "yt-dlp.exe".to_string()]),
        }
    }
}

fn parse_csv_env(name: &str) -> Option<Vec<String>> {
    let value = env::var(name).ok()?;
    let list = value
        .split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect::<Vec<_>>();
    if list.is_empty() { None } else { Some(list) }
}
