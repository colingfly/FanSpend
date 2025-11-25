# FanSpend 🏈🏀⚾

A loyalty rewards platform that connects to users' bank accounts and rewards sports fans for spending at team sponsors.

## How It Works

1. **Register** — Create an account and select your favorite MLB, NBA, and NFL teams
2. **Connect** — Link your bank account securely via Plaid
3. **Earn** — Automatically earn FanSpend points when you shop at team sponsors
4. **Reward** — 1 point per dollar spent (2x for Super Fans!)

## Features

- 🔐 Secure bank account linking via [Plaid](https://plaid.com/)
- 🏆 Support for MLB, NBA, and NFL team affiliations
- 🎯 Fuzzy matching to identify sponsor transactions
- 📊 Analytics dashboard for sponsors/partners
- ⚡ Real-time transaction processing

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** MySQL
- **Auth:** bcrypt.js, express-session
- **Banking:** Plaid API
- **Frontend:** Vanilla HTML/CSS/JS, Chart.js

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL database
- Plaid developer account (sandbox for testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/colingfly/FanSpend.git
cd FanSpend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Start the server
npm start
```

### Environment Variables

Create a `.env` file with the following:

```env
# Database
DATABASE_URL=mysql://user:password@host:port/database

# Plaid API (get from https://dashboard.plaid.com/)
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # sandbox, development, or production

# Session
SESSION_SECRET=your_random_secret_key

# Server
PORT=3000
```

## Project Structure

```
FanSpend/
├── server.js           # Express server & API routes
├── landing.html        # Welcome page
├── register.html       # User registration (team selection)
├── login.html          # User & customer login
├── homepage.html       # Main dashboard (Plaid connection, transactions)
├── insights.html       # Analytics dashboard for sponsors
├── package.json
├── .env.example
└── README.md
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register new fan account |
| POST | `/login` | Fan login |
| POST | `/customer-login` | Sponsor/partner login |

### Plaid Integration
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/create_link_token` | Initialize Plaid Link |
| POST | `/api/exchange_public_token` | Exchange for access token |
| GET | `/api/transactions` | Fetch & store transactions |

### Data & Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions_with_sponsors` | Get matched sponsor transactions |
| GET | `/api/total_spending_by_team` | Aggregate spending by team |
| GET | `/api/transactions_by_payment_channel` | Transaction breakdown |

## Points System

| Fan Status | Points per Dollar |
|------------|-------------------|
| Fan | 1x |
| Super Fan | 2x |

Points are awarded when a transaction merchant matches a sponsor in the database (using fuzzy string matching with a 60% similarity threshold).

## Database Schema

### Users
- `username`, `email`, `password`
- `mlb_fan_status`, `favorite_team` (MLB)
- `nba_fan_status`, `favorite_nba_team`
- `nfl_fan_status`, `favorite_nfl_team`

### Transactions
- `transaction_id`, `account_id`, `amount`, `date`
- `merchant_name`, `payment_channel`
- `personal_finance_category`

### Sponsors
- `merchant_name`, `league`

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test
```

## Deployment

The app is configured for Heroku deployment with JawsDB MySQL:

```bash
heroku create your-app-name
heroku addons:create jawsdb:kitefin
git push heroku main
```

## Roadmap

- [ ] Add more leagues (NHL, MLS, etc.)
- [ ] Mobile app (React Native)
- [ ] Rewards redemption system
- [ ] Push notifications for sponsor deals
- [ ] Leaderboards and social features

## License

MIT

## Contributing

Pull requests welcome! Please read the contributing guidelines first.
