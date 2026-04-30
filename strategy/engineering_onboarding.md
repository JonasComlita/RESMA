# Full-Stack Engineering Guidelines (2026)

This document outlines the expected technical proficiency and best practices for full-stack engineers joining the team. We prioritize speed, modern tooling, and a robust production mindset.

---

## 🏗️ Core Technology Stack

### 1. Frontend: React + TypeScript
**Principle**: Type-safe, performant, and maintainable user interfaces.
*   **Bun**: Our primary runtime for development and scripts. Use it for installing dependencies and running the local dev server.
*   **TypeScript 7.0+**: Strict typing is mandatory. Leverage advanced features like template literal types and improved inference.
*   **State Management**: Use **Zustand** or **Jotai** for global state; **TanStack Query** for server-state and caching.
*   **Styling**: **Tailwind CSS** for rapid UI development and design system consistency.

### 2. Backend: Python + uv
**Principle**: High-performance, strictly-typed API services.
*   **uv**: The standard for Python package management and virtual environments. It is significantly faster than pip/poetry.
*   **Frameworks**: **FastAPI** for modern, asynchronous APIs or **Django** for feature-rich, complex backends.
*   **Type Safety**: Use **Pydantic** for input validation and data serialization.
*   **Background Tasks**: **Celery** with Redis as a broker for asynchronous processing and scheduled jobs.

### 3. Databases & Persistence
**Principle**: Relational for consistency, In-memory for speed.
*   **PostgreSQL**: Our primary relational store. Understand indexing, query optimization, and JSONB for flexible schemas.
*   **Redis**: Used for caching, session management, rate limiting, and as a task queue broker.

---

## 🛠️ Modern Tooling & Productivity

### 4. Terminal & CLI
**Principle**: Master the command line to maximize efficiency.
*   **Linux (Ubuntu Server)**: Proficiency in non-GUI environments is essential. You should be comfortable with SSH, shell scripting, and server debugging.
*   **Terminals**: We recommend **Ghostty** (for raw performance) or **Warp** (for AI-assisted workflows and team blocks).
*   **Git**: Beyond basic commits, you must master branching strategies (Gitflow/Trunk-based), rebasing, and resolving complex conflicts.

### 5. API Development & Testing
**Principle**: APIs should be self-documenting and thoroughly tested.
*   **Tools**: **Postman**, **Bruno**, or **Thunder Client** for API exploration and collection sharing.
*   **Testing**: 
    *   **Unit/Integration**: Vitest (Frontend), Pytest (Backend).
    *   **E2E**: **Playwright** for robust browser-based testing.

---

## ☁️ Infrastructure & DevOps

### 6. Containerization & Orchestration
**Principle**: If it runs in production, it runs in a container.
*   **Docker**: Every service must be containerized. Optimize your Dockerfiles for build speed and image size.
*   **Kubernetes (K8s)**: Understand the core concepts (Pods, Services, Ingress). We use managed services (EKS/AKS) for scaling.

### 7. Infrastructure as Code (IaC)
**Principle**: No manual infrastructure changes.
*   **Terraform**: Use Terraform (or OpenTofu) for provisioning cloud resources on **AWS**, **Azure**, or **Cloudflare**.
*   **CI/CD**: **GitHub Actions** for automating builds, tests, and deployments.

### 8. Edge Computing & CDN
**Principle**: Push logic and content as close to the user as possible.
*   **Cloudflare**: Leverage Cloudflare for DNS management, WAF security, and **Cloudflare Workers** for high-performance edge computing and serverless functions.

### 9. Networking & Reverse Proxies
**Principle**: Secure and efficient traffic management at the gateway.
*   **Nginx**:
    *   **Why it belongs**: The industry standard for reverse proxying, SSL termination, and Kubernetes Ingress. Essential for architectural control and high-performance static file serving.
    *   **The Optional View**: Many traditional Nginx tasks are now abstracted by Cloudflare or K8s-native gateways, but understanding the underlying mechanics remains a core engineering skill.
*   **Pingora**:
    *   **The Cutting Edge**: Cloudflare's Rust-based framework. We leverage Pingora for building custom, memory-safe, and ultra-fast proxy services that surpass Nginx's traditional performance and module limitations.
*   **QUIC & HTTP/3**:
    *   **The Modern Transport**: Mastery of UDP-based QUIC is essential. Understanding how it eliminates head-of-line blocking and enables 0-RTT handshakes is critical for our 2026 performance standards.
    *   **Full-Stack Impact**: We prioritize HTTP/3 across our entire stack—from Cloudflare edge to our internal Pingora proxies—to ensure resilient, low-latency connectivity.

---

## 🛡️ Security & Reliability Fundamentals

### 10. Security Basics
**Principle**: Security is everyone's responsibility.
*   **OWASP Top 10**: Stay informed on common vulnerabilities (Injection, Broken Auth, XSS).
*   **Secrets Management**: Never commit secrets. Use managed secrets stores and environment variable injection via CI/CD.
*   **Auth**: Familiarize yourself with **JWT**, **OAuth2**, and **Auth.js** (NextAuth).

### 11. Observability
**Principle**: If it isn't monitored, it's broken.
*   **Metrics**: **Prometheus** for data collection and **Grafana** for visualization.
*   **Logging**: Implement structured logging (e.g., `structlog` in Python) for easy searching and tracing.
*   **Tracing**: Use **OpenTelemetry** for distributed tracing across services.
*   **Error Tracking**: **Sentry** for real-time error reporting and performance monitoring.

---

## 🤝 Collaboration & Process

*   **Code Reviews**: Focus on logic, security, and performance. Be constructive and thorough.
*   **System Design**: Consider scalability, fault tolerance, and data integrity when proposing new features.
*   **Agile/Scrum**: We operate in fast-paced iterations with a focus on delivering value frequently.

---

## 🚀 Recommended Onboarding Path

1.  **Environment Setup**: Install Bun, uv, and set up your terminal with Ghostty/Warp.
2.  **Core Proficiency**: Master the Linux CLI and basic Git workflows.
3.  **Local Stack**: Dockerize a React + FastAPI app locally with PostgreSQL and Redis.
4.  **Automation**: Set up a basic GitHub Actions pipeline for testing your local project.
5.  **Infrastructure**: Explore our Terraform modules and provision a sandbox environment.
