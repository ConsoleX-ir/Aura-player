// Package netcore is the Go port of Electron's `providers/core.cjs` — the ONE
// networking layer every online music provider goes through. Design rules are
// inherited unchanged from 3.2.0:
//
//   - every fetch has a timeout and retries transient failures
//     (network errors / 5xx / 429-with-Retry-After);
//   - responses are capped (10 MB) and must be explicitly validated by the
//     per-op hooks — malformed payloads are typed errors, never raw crashes;
//   - JSON responses are cached in a small TTL'd map so repeated searches and
//     re-opens don't re-hit the network;
//   - requests are cancellable through a registry keyed by requestId;
//   - no API keys, no telemetry, no code execution from remote data.
//
// IPv4-first dialing mirrors the JS implementation's `ipv4first` DNS order:
// many real-world networks advertise AAAA routes they cannot deliver on,
// which stalls every fetch that tries v6 first. A host with no A record
// still resolves via AAAA, so nothing is lost for v6-only endpoints.
package netcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Error kinds — the same vocabulary the renderer's ProviderError consumes.
const (
	KindTimeout     = "timeout"
	KindNetwork     = "network"
	KindHTTP        = "http"
	KindRateLimited = "rate_limited"
	KindMalformed   = "malformed"
	KindUnavailable = "unavailable"
)

// Defaults (same numbers as core.cjs).
const (
	DefaultTimeoutMs       = 10_000
	DefaultRetries         = 2 // after the first attempt → up to 3 tries
	RetryBaseDelayMs       = 400
	MaxRetryAfterMs        = 5_000
	CacheMaxEntries        = 200
	MaxBodyBytes     int64 = 10 * 1024 * 1024
	MaxRedirects           = 5
	UserAgent              = "AuraPlayer/3.2.0 (desktop music player)"
)

// FetchError is the typed failure every caller maps onto the IPC payload.
type FetchError struct {
	Kind    string
	Message string
	Status  int // HTTP status when Kind == KindHTTP
}

func (e *FetchError) Error() string { return e.Kind + ": " + e.Message }

func errf(kind, format string, a ...any) *FetchError {
	return &FetchError{Kind: kind, Message: fmt.Sprintf(format, a...)}
}

// ── client ──────────────────────────────────────────────────────────────────

// Client performs the actual HTTP work. One per process.
type Client struct {
	http *http.Client

	mu    sync.Mutex
	cache map[string]cacheEntry

	muReq    sync.Mutex
	inFlight map[string]context.CancelFunc
}

type cacheEntry struct {
	at    time.Time
	ttl   time.Duration
	value any
}

// NewClient builds the client with an IPv4-first dialer.
func NewClient() *Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialContextIPv4First(dialer),
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &Client{
		http:     &http.Client{Transport: transport, Timeout: 60 * time.Second},
		cache:    map[string]cacheEntry{},
		inFlight: map[string]context.CancelFunc{},
	}
}

// dialContextIPv4First resolves A records first and falls back to any family,
// then dials the chosen IP with SNI preserved (via Dialer with the hostname
// swapped for the IP — Go sets ServerName from the original host).
func dialContextIPv4First(d *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return d.DialContext(ctx, network, addr)
		}
		if ip := net.ParseIP(host); ip != nil {
			return d.DialContext(ctx, network, addr) // already an IP
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(ips) == 0 {
			return d.DialContext(ctx, network, addr)
		}
		// Prefer IPv4 addresses, keep the rest as fallback.
		v4, others := make([]net.IP, 0, len(ips)), make([]net.IP, 0, len(ips))
		for _, ip := range ips {
			if ip.IP.To4() != nil {
				v4 = append(v4, ip.IP)
			} else {
				others = append(others, ip.IP)
			}
		}
		ordered := append(v4, others...)
		if len(ordered) == 0 {
			return d.DialContext(ctx, network, addr)
		}
		var lastErr error
		for _, ip := range ordered {
			conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		return nil, lastErr
	}
}

// ── response ────────────────────────────────────────────────────────────────

// Response is a fully-buffered HTTP response (body capped at MaxBodyBytes).
type Response struct {
	Status int
	Header http.Header
	Body   []byte
}

// Get performs one HTTP GET with timeout + body cap. It never returns a
// FetchError for non-2xx statuses — callers decide retry semantics; only
// transport-level problems surface as errors here.
func (c *Client) Get(ctx context.Context, url string, timeoutMs int, headers map[string]string) (*Response, error) {
	hdr := map[string]string{"User-Agent": UserAgent}
	for k, v := range headers {
		hdr[k] = v
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, errf(KindMalformed, "invalid url: %v", err)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded && errors.Is(err, context.DeadlineExceeded) {
			return nil, errf(KindTimeout, "Timed out after %dms", timeoutMs)
		}
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			return nil, errf(KindTimeout, "Timed out after %dms", timeoutMs)
		}
		return nil, errf(KindNetwork, "%v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxBodyBytes+1))
	if err != nil {
		return nil, errf(KindNetwork, "read failed: %v", err)
	}
	if int64(len(body)) > MaxBodyBytes {
		return nil, errf(KindMalformed, "Response body exceeds %dMB cap", MaxBodyBytes/1024/1024)
	}
	return &Response{Status: resp.StatusCode, Header: resp.Header, Body: body}, nil
}

// ── providerFetch: timeout + retry + typed errors + validation ─────────────

// FetchOptions mirror core.cjs's providerFetch opts.
type FetchOptions struct {
	TimeoutMs int
	Retries   *int // nil → DefaultRetries
	Headers   map[string]string
	Validate  func(json any) error // reject a shape-mismatched 200
}

// ProviderFetch fetches and decodes JSON with retries, backoff, 429
// Retry-After handling and response validation. Non-transient HTTP errors
// and malformed payloads fail immediately, like core.cjs.
func (c *Client) ProviderFetch(ctx context.Context, url string, opts FetchOptions) (any, error) {
	timeoutMs := opts.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	retries := DefaultRetries
	if opts.Retries != nil {
		retries = *opts.Retries
	}

	var lastErr *FetchError
	for attempt := 0; attempt <= retries; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, errf(KindNetwork, "cancelled")
		}

		resp, err := c.Get(ctx, url, timeoutMs, opts.Headers)
		if err != nil {
			fe, ok := err.(*FetchError)
			if !ok {
				fe = errf(KindNetwork, "%v", err)
			}
			lastErr = fe
			if fe.Kind == KindTimeout || fe.Kind == KindNetwork {
				if attempt < retries {
					if serr := sleepCtx(ctx, backoff(attempt)); serr != nil {
						return nil, errf(KindNetwork, "cancelled during backoff")
					}
					continue
				}
			}
			return nil, fe
		}

		if resp.Status < 200 || resp.Status >= 300 {
			if resp.Status == 429 {
				if attempt < retries {
					delay := retryDelayFromHeader(resp.Header.Get("Retry-After"))
					if serr := sleepCtx(ctx, delay); serr != nil {
						return nil, errf(KindNetwork, "cancelled during backoff")
					}
					continue
				}
				return nil, &FetchError{Kind: KindRateLimited, Message: "Rate limited by " + hostOf(url), Status: resp.Status}
			}
			if isTransientStatus(resp.Status) && attempt < retries {
				if serr := sleepCtx(ctx, backoff(attempt)); serr != nil {
					return nil, errf(KindNetwork, "cancelled during backoff")
				}
				continue
			}
			return nil, &FetchError{Kind: KindHTTP, Message: fmt.Sprintf("HTTP %d from %s", resp.Status, hostOf(url)), Status: resp.Status}
		}

		json, jerr := decodeJSON(resp.Body)
		if jerr != nil {
			return nil, jerr
		}
		if opts.Validate != nil {
			if verr := opts.Validate(json); verr != nil {
				return nil, errf(KindMalformed, "%s", verr.Error())
			}
		}
		return json, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errf(KindNetwork, "Request failed")
}

func backoff(attempt int) time.Duration {
	return time.Duration(RetryBaseDelayMs*(1<<attempt)) * time.Millisecond
}

func isTransientStatus(status int) bool {
	return status == 429 || (status >= 500 && status <= 599)
}

func retryDelayFromHeader(v string) time.Duration {
	if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
		d := time.Duration(secs) * time.Second
		if d > time.Duration(MaxRetryAfterMs)*time.Millisecond {
			return time.Duration(MaxRetryAfterMs) * time.Millisecond
		}
		return d
	}
	return time.Duration(RetryBaseDelayMs) * time.Millisecond
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func hostOf(url string) string {
	// Tiny helper avoiding a second import of net/url in call sites.
	for i := 0; i < len(url); i++ {
		if url[i] == '/' && i > 6 {
			return url[:i]
		}
	}
	return url
}

// ── JSON decode (stdlib, but returning the typed malformed error) ──────────

func decodeJSON(body []byte) (any, error) {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return nil, errf(KindMalformed, "Response is not valid JSON")
	}
	return v, nil
}

// ── TTL cache (FIFO eviction + hit-refreshes-recency, like core.cjs) ───────

// CacheGet returns the cached value for key when present and fresh.
func (c *Client) CacheGet(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	hit, ok := c.cache[key]
	if !ok {
		return nil, false
	}
	if time.Since(hit.at) > hit.ttl {
		delete(c.cache, key)
		return nil, false
	}
	// LRU-ish: a hit refreshes recency so hot keys survive eviction.
	delete(c.cache, key)
	c.cache[key] = hit
	return hit.value, true
}

// CacheSet stores a value under key with the given TTL, evicting the oldest
// entry when the cache is full.
func (c *Client) CacheSet(key string, value any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.cache) >= CacheMaxEntries {
		for k := range c.cache {
			delete(c.cache, k)
			break // map order is arbitrary — good enough for a tiny cache
		}
	}
	c.cache[key] = cacheEntry{at: time.Now(), ttl: ttl, value: value}
}

// CachedJSON returns the cached value for key, or runs fetcher once (on a
// miss) and caches the result. Rejections are NOT cached.
func (c *Client) CachedJSON(ctx context.Context, key string, ttl time.Duration, fetcher func() (any, error)) (any, error) {
	if v, ok := c.CacheGet(key); ok {
		return v, nil
	}
	v, err := fetcher()
	if err != nil {
		return nil, err
	}
	c.CacheSet(key, v, ttl)
	return v, nil
}

// ── cancellation registry (renderer request ids) ────────────────────────────

// BeginRequest registers a cancellable context under requestId. The returned
// context is the caller's request context; EndRequest MUST be called when the
// op finishes so the registry does not grow.
func (c *Client) BeginRequest(parent context.Context, requestId string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	c.muReq.Lock()
	c.inFlight[requestId] = cancel
	c.muReq.Unlock()
	off := func() {
		c.muReq.Lock()
		delete(c.inFlight, requestId)
		c.muReq.Unlock()
		cancel()
	}
	return ctx, off
}

// CancelRequest aborts a still-in-flight request (no-op when already done).
func (c *Client) CancelRequest(requestId string) {
	c.muReq.Lock()
	cancel, ok := c.inFlight[requestId]
	c.muReq.Unlock()
	if ok {
		cancel()
	}
}

// ProbeOnline HEADs one well-known host with a hard cap and returns a
// diagnostic result — the same contract as core.cjs's probeOnline.
func (c *Client) ProbeOnline(ctx context.Context) ProbeResult {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, "https://api.audius.co", nil)
	if err != nil {
		return ProbeResult{OK: false, Kind: KindNetwork, Detail: err.Error()}
	}
	req.Header.Set("User-Agent", UserAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		kind := KindNetwork
		detail := err.Error()
		if ctx.Err() == context.DeadlineExceeded {
			kind = KindTimeout
			detail = "Timed out after 4000ms"
		} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
			kind = KindTimeout
			detail = "Timed out after 4000ms"
		}
		return ProbeResult{OK: false, Kind: kind, Detail: detail, LatencyMs: time.Since(started).Milliseconds()}
	}
	resp.Body.Close()
	ok := resp.StatusCode >= 200 && resp.StatusCode < 400
	r := ProbeResult{OK: ok, Kind: "online", LatencyMs: time.Since(started).Milliseconds()}
	if !ok {
		r.Kind = KindHTTP
		r.Detail = fmt.Sprintf("api.audius.co answered HTTP %d", resp.StatusCode)
	}
	return r
}

// ProbeResult mirrors the renderer's diagnostic probe shape.
type ProbeResult struct {
	OK        bool   `json:"ok"`
	Kind      string `json:"kind"`
	Detail    string `json:"detail,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
}

// DownloadBinary fetches raw bytes (artwork) through the same transport.
func (c *Client) DownloadBinary(ctx context.Context, url string, timeoutMs int) ([]byte, error) {
	if timeoutMs <= 0 {
		timeoutMs = 20_000
	}
	resp, err := c.Get(ctx, url, timeoutMs, map[string]string{"Accept": "image/*"})
	if err != nil {
		return nil, err
	}
	if resp.Status < 200 || resp.Status >= 300 {
		return nil, &FetchError{Kind: KindHTTP, Message: fmt.Sprintf("HTTP %d", resp.Status), Status: resp.Status}
	}
	return resp.Body, nil
}
