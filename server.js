require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const url = require('url');
const session = require('express-session');
const path = require('path');
const bcryptjs = require('bcryptjs');
const stringSimilarity = require('string-similarity');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Create Express app
const app = express();
app.set('trust proxy', 1);

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(express.json());

// Request logging (disable in production if needed)
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// =============================================================================
// DATABASE CONNECTION
// =============================================================================

const dbUrl = process.env.JAWSDB_URL || process.env.DATABASE_URL;

if (!dbUrl) {
    console.error('ERROR: No database URL configured. Set DATABASE_URL or JAWSDB_URL.');
    process.exit(1);
}

const dbConfig = url.parse(dbUrl);
const [dbUser, dbPassword] = dbConfig.auth.split(':');

const db = mysql.createConnection({
    host: dbConfig.hostname,
    user: dbUser,
    password: dbPassword,
    database: dbConfig.pathname.substring(1),
    ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        process.exit(1);
    }
    console.log('Connected to MySQL database.');
});

// =============================================================================
// PLAID CONFIGURATION
// =============================================================================

const plaidEnv = process.env.PLAID_ENV || 'sandbox';
const plaidEnvMap = {
    sandbox: PlaidEnvironments.sandbox,
    development: PlaidEnvironments.development,
    production: PlaidEnvironments.production
};

if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    console.warn('WARNING: Plaid credentials not configured. Bank linking will not work.');
}

const plaidConfig = new Configuration({
    basePath: plaidEnvMap[plaidEnv] || PlaidEnvironments.sandbox,
    baseOptions: {
        headers: {
            'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
            'PLAID-SECRET': process.env.PLAID_SECRET,
        },
    },
});
const plaidClient = new PlaidApi(plaidConfig);

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

const requireAuth = (req, res, next) => {
    if (!req.session.username) {
        return res.redirect('/login.html');
    }
    next();
};

const requireCustomerAuth = (req, res, next) => {
    if (!req.session.customer_email) {
        return res.redirect('/login.html?type=customer');
    }
    next();
};

// =============================================================================
// STATIC ROUTES
// =============================================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/homepage.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'homepage.html')));
app.get('/insights.html', requireCustomerAuth, (req, res) => res.sendFile(path.join(__dirname, 'insights.html')));

// =============================================================================
// AUTH ROUTES
// =============================================================================

app.post('/register', async (req, res) => {
    try {
        const { 
            username, email, password, 
            mlbFanStatus, favoriteMLBTeam, 
            nbaFanStatus, favoriteNBATeam, 
            nflFanStatus, favoriteNFLTeam 
        } = req.body;

        // Validate fan status
        if (mlbFanStatus === 'Not a Fan' && nbaFanStatus === 'Not a Fan' && nflFanStatus === 'Not a Fan') {
            return res.status(400).json({ message: 'You must be a fan of at least one league to register.' });
        }

        const hashedPassword = await bcryptjs.hash(password, 10);

        const query = `
            INSERT INTO users (username, email, password, mlb_fan_status, favorite_team, nba_fan_status, favorite_nba_team, nfl_fan_status, favorite_nfl_team) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(query, [username, email, hashedPassword, mlbFanStatus, favoriteMLBTeam, nbaFanStatus, favoriteNBATeam, nflFanStatus, favoriteNFLTeam], (err, result) => {
            if (err) {
                console.error('Registration error:', err);
                return res.status(500).json({ message: 'Registration failed', error: err.message });
            }
            req.session.user_id = result.insertId;
            req.session.username = username;
            res.status(201).json({ message: 'Registration successful' });
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (err) {
            console.error('Login error:', err);
            return res.status(500).json({ message: 'Login failed' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = results[0];
        const match = await bcryptjs.compare(password, user.password);
        
        if (match) {
            req.session.username = username;
            req.session.user_id = user.id;
            res.status(200).json({ message: 'Logged in successfully' });
        } else {
            res.status(401).json({ message: 'Incorrect username or password' });
        }
    });
});

app.post('/customer-login', async (req, res) => {
    const { username: email, password } = req.body;
    
    db.query('SELECT * FROM customers WHERE email = ?', [email], async (err, results) => {
        if (err) {
            console.error('Customer login error:', err);
            return res.status(500).json({ message: 'Login failed' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        const customer = results[0];
        
        // TODO: Customer passwords should be hashed too!
        // For now, comparing plaintext (migrate existing passwords to bcrypt)
        const match = customer.password_hash 
            ? await bcryptjs.compare(password, customer.password_hash)
            : password === customer.password;

        if (match) {
            req.session.customer_email = email;
            res.status(200).json({ message: 'Logged in successfully' });
        } else {
            res.status(401).json({ message: 'Incorrect email or password' });
        }
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.status(200).json({ message: 'Logged out successfully' });
});

// =============================================================================
// PLAID ROUTES
// =============================================================================

app.post('/api/create_link_token', async (req, res) => {
    const username = req.session.username;
    
    if (!username) {
        return res.status(400).json({ message: 'No user session found' });
    }

    try {
        const response = await plaidClient.linkTokenCreate({
            user: { client_user_id: username },
            client_name: 'FanSpend',
            products: ['transactions'],
            country_codes: ['US'],
            language: 'en',
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error creating link token:', error);
        res.status(500).json({ message: 'Error creating link token', error: error.message });
    }
});

app.post('/api/exchange_public_token', async (req, res) => {
    const { public_token } = req.body;
    
    if (!public_token) {
        return res.status(400).json({ message: 'Public token is required.' });
    }

    try {
        const response = await plaidClient.itemPublicTokenExchange({ public_token });
        const { access_token, item_id } = response.data;
        console.log('Token exchange successful for item:', item_id);
        res.json({ access_token, item_id });
    } catch (error) {
        console.error('Error exchanging public token:', error);
        res.status(500).json({ message: 'Error exchanging public token', error: error.message });
    }
});

app.get('/api/transactions', async (req, res) => {
    const access_token = req.query.access_token;
    const username = req.session.username;
    const user_id = req.session.user_id;

    if (!access_token) {
        return res.status(400).json({ message: 'Access token is required' });
    }

    // Fetch last 30 days of transactions
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        const response = await plaidClient.transactionsGet({
            access_token,
            start_date: startDate,
            end_date: endDate,
        });

        const transactions = response.data.transactions;

        // Store transactions in database
        for (const txn of transactions) {
            const query = `
                INSERT INTO transactions (username, transaction_id, account_id, account_owner, amount, date, name, payment_channel, transaction_type, iso_currency_code, merchant_name, personal_finance_category, confidence_level, user_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
                ON DUPLICATE KEY UPDATE amount = VALUES(amount), date = VALUES(date)
            `;

            db.query(query, [
                username,
                txn.transaction_id,
                txn.account_id,
                txn.account_owner,
                txn.amount,
                txn.date,
                txn.name,
                txn.payment_channel,
                txn.transaction_type,
                txn.iso_currency_code,
                txn.merchant_name,
                txn.personal_finance_category?.primary || null,
                txn.personal_finance_category?.confidence_level || null,
                user_id
            ], (err) => {
                if (err) console.error('Error storing transaction:', err.message);
            });
        }

        res.json(transactions);
    } catch (error) {
        console.error('Error retrieving transactions:', error);
        res.status(500).json({ message: 'Error retrieving transactions', error: error.message });
    }
});

// =============================================================================
// FANSPEND POINTS LOGIC
// =============================================================================

const FAN_STATUS_MULTIPLIERS = {
    'Fan': 1,
    'Super Fan': 2,
};

const getBestMatch = (merchantName, sponsorNames) => {
    if (!merchantName || sponsorNames.length === 0) return null;
    const matches = stringSimilarity.findBestMatch(merchantName, sponsorNames);
    return matches.bestMatch.rating >= 0.6 ? matches.bestMatch.target : null;
};

const getFanStatusForLeague = (league, user) => {
    const statusMap = {
        'MLB': user.mlb_fan_status,
        'NBA': user.nba_fan_status,
        'NFL': user.nfl_fan_status,
    };
    return statusMap[league] || null;
};

const calculateFanSpendPoints = (amount, fanStatus) => {
    const multiplier = FAN_STATUS_MULTIPLIERS[fanStatus] || 0;
    return Math.round(Math.abs(amount) * multiplier);
};

app.get('/api/transactions_with_sponsors', (req, res) => {
    const username = req.session.username;

    if (!username) {
        return res.status(400).json({ message: 'No user session found' });
    }

    // Get sponsors
    db.query('SELECT merchant_name, league FROM sponsors', (err, sponsorResults) => {
        if (err) {
            console.error('Error fetching sponsors:', err);
            return res.status(500).json({ message: 'Error fetching sponsors' });
        }

        const sponsorNames = sponsorResults.map(s => s.merchant_name);
        const sponsorLeagueMap = Object.fromEntries(
            sponsorResults.map(s => [s.merchant_name, s.league])
        );

        // Get user transactions
        const query = `
            SELECT t.*, u.mlb_fan_status, u.nba_fan_status, u.nfl_fan_status,
                   u.favorite_team, u.favorite_nba_team, u.favorite_nfl_team
            FROM transactions t
            JOIN users u ON t.username = u.username
            WHERE u.username = ?
            ORDER BY t.date DESC
        `;

        db.query(query, [username], (err, transactions) => {
            if (err) {
                console.error('Error fetching transactions:', err);
                return res.status(500).json({ message: 'Error fetching transactions' });
            }

            const matchedTransactions = transactions.reduce((acc, txn) => {
                const matchedSponsor = getBestMatch(txn.merchant_name, sponsorNames);
                if (!matchedSponsor) return acc;

                const league = sponsorLeagueMap[matchedSponsor];
                const fanStatus = getFanStatusForLeague(league, txn);

                if (!fanStatus || fanStatus === 'Not a Fan') return acc;

                acc.push({
                    ...txn,
                    matched_sponsor: matchedSponsor,
                    sponsor_league: league,
                    fanspend_points: calculateFanSpendPoints(txn.amount, fanStatus),
                });
                return acc;
            }, []);

            res.json(matchedTransactions);
        });
    });
});

// =============================================================================
// ANALYTICS ROUTES
// =============================================================================

app.get('/api/total_spending_by_team', (req, res) => {
    const query = `
        SELECT u.favorite_team, SUM(t.amount) AS total_spending
        FROM users u
        JOIN transactions t ON u.username = t.username
        GROUP BY u.favorite_team
        ORDER BY total_spending DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching spending by team:', err);
            return res.status(500).json({ message: 'Error fetching data' });
        }
        res.json(results);
    });
});

app.get('/api/transactions_by_payment_channel', (req, res) => {
    const query = `
        SELECT t.payment_channel, COUNT(*) AS transaction_count
        FROM users u
        JOIN transactions t ON u.username = t.username
        GROUP BY t.payment_channel
        ORDER BY transaction_count DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching by payment channel:', err);
            return res.status(500).json({ message: 'Error fetching data' });
        }
        res.json(results);
    });
});

app.get('/api/transactions_by_team', (req, res) => {
    const { teamName } = req.query;

    if (!teamName) {
        return res.status(400).json({ message: 'Team name is required' });
    }

    const query = `
        SELECT t.payment_channel, COUNT(*) AS transaction_count
        FROM users u
        JOIN transactions t ON u.username = t.username
        WHERE u.favorite_team = ?
        GROUP BY t.payment_channel
        ORDER BY transaction_count DESC
    `;

    db.query(query, [teamName], (err, results) => {
        if (err) {
            console.error('Error fetching transactions by team:', err);
            return res.status(500).json({ message: 'Error fetching data' });
        }
        res.json(results);
    });
});

// =============================================================================
// START SERVER
// =============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`FanSpend server running on port ${PORT}`);
});
