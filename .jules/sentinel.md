## 2024-05-01 - [Reverse Proxy Rate Limiting Vulnerability]
**Vulnerability:** Found that the Express application was missing the `trust proxy` configuration while using IP-based rate limiters (`req.ip`).
**Learning:** Without `app.set('trust proxy', 1);`, Express apps behind reverse proxies (like Nginx, AWS ALB) will identify all client requests as originating from the proxy's IP. This means global IP rate limits will count all users against a single quota, creating a trivial, widespread Denial of Service vulnerability while completely bypassing intended per-user limits.
**Prevention:** Always explicitly define proxy trust boundaries using `app.set('trust proxy', ...)` when deploying Node apps behind load balancers, and verify that IP-based logic uses the correct client IP.
