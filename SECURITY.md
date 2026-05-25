# Security Policy

## Reporting Vulnerabilities
Email: security@hiai.store (placeholder)
Do NOT open public GitHub issues for security vulnerabilities.

## Supported Versions
| Version | Supported |
|---------|-----------|
| 1.x     | ✅ |

## Security Measures
- Better Auth with session management
- AES-256-GCM encrypted OAuth token storage
- Redis-backed rate limiting per platform
- Multi-tenant data isolation
- SQL injection prevention via Drizzle ORM
- CSRF protection on OAuth flows
