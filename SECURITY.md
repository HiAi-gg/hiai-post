# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in hiai-post, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please use one of these channels:

- **GitHub Security Advisories** (preferred):
  https://github.com/HiAi-gg/hiai-post/security/advisories/new
- **Email**: open a GitHub issue tagged `[security]` first to request a private disclosure channel

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix or mitigation**: within 30 days for critical/high severity

### Scope

In-scope vulnerabilities include:

- Authentication/authorization bypass
- SQL injection or data leakage between tenants
- Cross-site scripting (XSS) in rendered content
- Remote code execution
- Path traversal or file upload abuse
- Rate limiting bypass on public endpoints
- Exposure of secrets or credentials
- RBAC bypass (cross-tenant access)

### Out of scope

- Social engineering attacks
- Denial of service (DoS)
- Issues in third-party dependencies (report upstream)
- Issues requiring physical access to the server

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Security Measures

- Better Auth with session management + optional HS256 admin JWT (shared with hiai-admin proxy)
- AES-256-GCM encrypted OAuth token storage
- Redis-backed per-tenant rate limiting (dual-bucket fallback to global IP)
- Multi-tenant data isolation (every query scoped by `tenant_id`)
- SQL injection prevention via Drizzle ORM parameterized queries
- CSRF protection on OAuth flows
- Audit logging on all state-changing operations (POST/PUT/PATCH/DELETE) with sensitive-key redaction
- Per-route RBAC (`requireViewer` / `requireEditor` / `requireAdmin` / `requireOwner`)