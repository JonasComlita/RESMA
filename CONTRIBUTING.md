# Contributing to RESMA

Thank you for your interest in contributing to RESMA! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/resma.git`
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b feature/your-feature`

## 📁 Project Structure

- `extension/` - Chrome browser extension
- `backend/` - Express API server
- `forum/` - React frontend

## 🛠️ Development

```bash
# Start all services
bun run dev

# Run backend only
bun run --filter backend dev

# Run forum only
bun run --filter forum dev

# Build extension
bun run --filter extension build
```

## 📝 Commit Guidelines

We use conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

## 🔒 Privacy First

When contributing to data collection features:
- Never store PII without explicit consent
- Always anonymize data before submission
- Respect user preferences and opt-out choices

## 📋 Pull Request Process

1. Ensure tests pass: `bun run test`
2. Update documentation if needed
3. Request review from maintainers

## 📜 Code of Conduct

Be respectful, inclusive, and constructive in all interactions.
