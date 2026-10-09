use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderName, HeaderValue};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Fallback timeout when the frontend does not provide one.
pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;
/// Hard ceiling for a single request so a hostile feed cannot pin a connection open.
pub const MAX_TIMEOUT_MS: u64 = 60_000;
/// Feeds, progression payloads and search results are text documents; anything larger is
/// rejected before it can be buffered in memory.
pub const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "educk/0.1.0 (Android; OPDS 1.2 Client)";

/// Request payload sent by the frontend transport (`src/services/http/http-transport.ts`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestArgs {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// Transport-level response, deliberately limited to textual bodies (OPDS Atom feeds and
/// progression JSON). Binary payloads go through the download engine instead.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTextResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Shared HTTP client for feed, search and progression traffic.
pub struct HttpClient {
    client: Client,
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }

    /// Performs a single request and buffers the response body as text.
    ///
    /// Errors are returned as user-readable strings; HTTP error statuses are *not* errors,
    /// because the OPDS authentication flow needs to observe 401/403 responses.
    pub async fn send_text(&self, request: HttpRequestArgs) -> Result<HttpTextResponse, String> {
        validate_url(&request.url)?;
        let method = parse_method(request.method.as_deref())?;
        let timeout = clamp_timeout(request.timeout_ms);

        let mut builder = self.client.request(method, &request.url).timeout(timeout);

        if let Some(headers) = &request.headers {
            for (name, value) in headers {
                let header_name = HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| format!("Invalid request header name: {name}"))?;
                let header_value = HeaderValue::from_str(value)
                    .map_err(|_| format!("Invalid value for request header: {name}"))?;
                builder = builder.header(header_name, header_value);
            }
        }

        if let Some(body) = &request.body {
            builder = builder.body(body.clone());
        }

        let response = builder.send().await.map_err(describe_error)?;
        read_text_response(response).await
    }
}

/// Rejects everything that is not plain HTTP(S): ebook content and OPDS entries are untrusted
/// input and must never reach `file:`, `data:`, `javascript:` or custom protocols.
pub fn validate_url(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err(format!(
            "Blocked non-HTTP URL scheme: {}",
            url.chars().take(64).collect::<String>()
        ))
    }
}

fn parse_method(method: Option<&str>) -> Result<Method, String> {
    let method = method.unwrap_or("GET").to_ascii_uppercase();
    match method.as_str() {
        "GET" | "HEAD" | "POST" | "PUT" | "DELETE" => Ok(Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("Invalid HTTP method: {method}"))?),
        _ => Err(format!("HTTP method not allowed: {method}")),
    }
}

fn clamp_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1_000, MAX_TIMEOUT_MS))
}

async fn read_text_response(response: Response) -> Result<HttpTextResponse, String> {
    let status = response.status();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or_default()
        .to_string();

    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        headers.insert(
            name.as_str().to_string(),
            String::from_utf8_lossy(value.as_bytes()).into_owned(),
        );
    }

    if let Some(length) = response.content_length() {
        if length > MAX_BODY_BYTES as u64 {
            return Err(format!(
                "Response body of {length} bytes exceeds the {MAX_BODY_BYTES} byte limit"
            ));
        }
    }

    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(describe_error)?;
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(format!(
                "Response body exceeds the {MAX_BODY_BYTES} byte limit"
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    Ok(HttpTextResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

fn describe_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The request timed out".to_string();
    }
    if error.is_connect() {
        return format!("Could not connect to the server: {error}");
    }
    if error.is_decode() {
        return format!("Malformed response from the server: {error}");
    }
    error.to_string()
}

/// Native HTTP transport for OPDS feeds, search and progression synchronization.
///
/// The WebView cannot be used for this traffic: OPDS servers do not send CORS headers and
/// Android blocks cleartext HTTP in release builds. Doing it natively also keeps protocol
/// logic out of the UI layer.
#[tauri::command]
pub async fn http_request(
    state: State<'_, HttpClient>,
    request: HttpRequestArgs,
) -> Result<HttpTextResponse, String> {
    state.send_text(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::JoinHandle;

    fn spawn_server(raw_response: String) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("local addr");
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 8192];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(raw_response.as_bytes());
            }
        });
        (format!("http://{address}"), handle)
    }

    fn request(url: &str) -> HttpRequestArgs {
        HttpRequestArgs {
            url: url.to_string(),
            method: Some("GET".to_string()),
            headers: None,
            body: None,
            timeout_ms: Some(5_000),
        }
    }

    #[test]
    fn rejects_untrusted_url_schemes() {
        for url in [
            "javascript:alert(1)",
            "file:///data/local/tmp/secrets",
            "data:text/html,<script>alert(1)</script>",
            "ftp://example.com/book.epub",
            "content://media/external/file",
        ] {
            assert!(validate_url(url).is_err(), "expected {url} to be rejected");
        }
        assert!(validate_url("https://example.com/opds").is_ok());
        assert!(validate_url("http://192.168.0.100:8000/opds").is_ok());
    }

    #[test]
    fn rejects_disallowed_methods_and_unbounded_timeouts() {
        assert!(parse_method(Some("TRACE")).is_err());
        assert!(parse_method(Some("OPTIONS")).is_err());
        assert_eq!(parse_method(None).unwrap(), Method::GET);
        assert_eq!(parse_method(Some("put")).unwrap(), Method::PUT);

        assert_eq!(clamp_timeout(None), Duration::from_millis(DEFAULT_TIMEOUT_MS));
        assert_eq!(clamp_timeout(Some(1)), Duration::from_millis(1_000));
        assert_eq!(
            clamp_timeout(Some(u64::MAX)),
            Duration::from_millis(MAX_TIMEOUT_MS)
        );
    }

    #[tokio::test]
    async fn returns_status_headers_and_body() {
        let (url, server) = spawn_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/atom+xml; charset=utf-8\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<feed></feed>"
                .to_string(),
        );

        let client = HttpClient::new();
        let response = client.send_text(request(&url)).await.expect("response");

        assert_eq!(response.status, 200);
        assert_eq!(response.status_text, "OK");
        assert_eq!(response.body, "<feed></feed>");
        assert!(response
            .headers
            .get("content-type")
            .expect("content-type header")
            .starts_with("application/atom+xml"));

        server.join().expect("server thread");
    }

    #[tokio::test]
    async fn surfaces_http_error_statuses_instead_of_failing() {
        let (url, server) = spawn_server(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        );

        let client = HttpClient::new();
        let response = client.send_text(request(&url)).await.expect("response");

        assert_eq!(response.status, 401);
        assert_eq!(response.status_text, "Unauthorized");

        server.join().expect("server thread");
    }

    #[tokio::test]
    async fn rejects_oversized_declared_bodies() {
        let (url, server) = spawn_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 99999999999\r\nConnection: close\r\n\r\n"
                .to_string(),
        );

        let client = HttpClient::new();
        let error = client.send_text(request(&url)).await.expect_err("must fail");
        assert!(error.contains("exceeds"), "unexpected error: {error}");

        server.join().expect("server thread");
    }

    #[tokio::test]
    async fn rejects_invalid_scheme_before_touching_the_network() {
        let client = HttpClient::new();
        let error = client
            .send_text(request("file:///etc/passwd"))
            .await
            .expect_err("must fail");
        assert!(error.contains("Blocked non-HTTP URL scheme"), "{error}");
    }

    #[tokio::test]
    async fn does_not_follow_redirects_to_non_http_schemes() {
        // An untrusted feed may answer with `Location: file://...`. The redirect target is
        // never opened: reqwest refuses to follow it and the 3xx response is surfaced to the
        // caller, which treats any non-2xx status as a feed error.
        let (url, server) = spawn_server(
            "HTTP/1.1 302 Found\r\nLocation: file:///data/local/tmp/secrets\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        );

        let client = HttpClient::new();
        let response = client.send_text(request(&url)).await.expect("response");

        assert_eq!(response.status, 302);
        assert_eq!(
            response.headers.get("location").map(String::as_str),
            Some("file:///data/local/tmp/secrets")
        );
        assert!(response.body.is_empty(), "nothing was read from the target");

        server.join().expect("server thread");
    }
    #[tokio::test]
    async fn reports_connection_failures_without_panicking() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("local addr");
        drop(listener);

        let client = HttpClient::new();
        let error = client
            .send_text(request(&format!("http://{address}")))
            .await
            .expect_err("must fail");
        assert!(!error.is_empty());
    }
}
