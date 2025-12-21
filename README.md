# RESMA - Reverse Engineering Social Media Algorithms

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Open-source platform for collectively understanding how TikTok's algorithm shapes feeds through crowdsourced data collection and community collaboration.

## 🎯 Vision

Social media algorithms are black boxes that shape what billions of people see daily. RESMA empowers users to:

- **Capture** their TikTok feed data through a browser extension
- **Compare** their feeds with others to discover patterns
- **Collaborate** in forums to understand algorithmic behavior
- **Contribute** to open research on recommendation systems

## 🏗️ Project Structure

```
resma/
├── extension/     # Chrome browser extension
├── backend/       # Node.js + Express API
└── forum/         # React frontend
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- PostgreSQL 15+
- Redis (optional, for caching)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/resma.git
cd resma

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env

# Start database
docker-compose up -d postgres

# Run migrations
pnpm --filter backend db:migrate

# Start development servers
pnpm dev
```

## 📦 Packages

| Package | Description |
|---------|-------------|
| `extension` | Chrome extension for TikTok feed capture |
| `backend` | Express API for data storage and analysis |
| `forum` | React-based community platform |

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is for research and educational purposes. Users are responsible for ensuring their use complies with applicable terms of service and laws. All data collection requires explicit user consent.
