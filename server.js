const express = require('express');
const mysql = require('mysql');
const url = require('url');
const session = require('express-session');
const path = require('path');
const plaid = require('plaid');
const bcryptjs = require('bcryptjs');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Create an Express app
const app = express();

// Set up session middleware
app.use(session({
    secret: 'yourSecretKey',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to log incoming requests
app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.path}`, req.body);
    next();
});

// Middleware to check if customer is logged in for the insights page
app.use('/insights.html', (req, res, next) => {
    if (!req.session.customer_email) {
        return res.redirect('/login.html?type=customer');
    }
    next();
});

// Serve HTML files for different pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/homepage.html', (req, res) => res.sendFile(path.join(__dirname, 'homepage.html')));
app.get('/insights.html', (req, res) => res.sendFile(path.join(__dirname, 'insights.html')));
app.get('/team-login.html', (req, res) => res.sendFile(path.join(__dirname, 'team-login.html')));

// MySQL database connection
const dbUrl = process.env.JAWSDB_URL || 'mysql://mxw0qiguljklguq1:ajolmli2cn4r742b@u28rhuskh0x5paau.cbetxkdyhwsb.us-east-1.rds.amazonaws.com:3306/x9tkoyqxyhhgo64i';
const dbConfig = url.parse(dbUrl);
const [user, password] = dbConfig.auth.split(':');

const db = mysql.createConnection({
    host: dbConfig.hostname,
    user: user,
    password: password,
    database: dbConfig.pathname.substring(1),
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to the MySQL server.');
});

app.post('/register', async (req, res) => {
    const { username, email, password, mlbFanStatus, favoriteMLBTeam, nbaFanStatus, favoriteNBATeam, nflFanStatus, favoriteNFLTeam } = req.body;

    // Check if the user is a fan or super fan of at least one league
    if (mlbFanStatus === 'Not a Fan' && nbaFanStatus === 'Not a Fan' && nflFanStatus === 'Not a Fan') {
        return res.status(400).json({ message: 'You must be a fan or super fan of at least one league to register.' });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    const query = 'INSERT INTO users (username, email, password, mlb_fan_status, favorite_team, nba_fan_status, favorite_nba_team, nfl_fan_status, favorite_nfl_team) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

    db.query(query, [username, email, hashedPassword, mlbFanStatus, favoriteMLBTeam, nbaFanStatus, favoriteNBATeam, nflFanStatus, favoriteNFLTeam], (err, result) => {
        if (err) {
            console.error('Error registering new user:', err);
            return res.status(500).json({ message: 'Registration failed', error: err.message });
        } else {
            req.session.user_id = result.insertId;
            req.session.username = username;
            res.status(201).json({ message: 'Registration successful' });
        }
    });
});


app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], async (err, results) => {
        if (err) {
            console.error('Error logging in:', err);
            res.status(500).json({ message: 'Login failed' });
        } else if (results.length > 0) {
            const user = results[0];
            const match = await bcryptjs.compare(password, user.password);
            if (match) {
                req.session.username = username;
                res.status(200).json({ message: 'Logged in successfully' });
            } else {
                res.status(401).json({ message: 'Incorrect username or password' });
            }
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    });
});

app.post('/customer-login', async (req, res) => {
    const { username: email, password } = req.body;
    console.log('Received login request for:', email);
    const query = 'SELECT * FROM customers WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) {
            console.error('Error logging in:', err);
            res.status(500).json({ message: 'Login failed' });
        } else if (results.length > 0) {
            const customer = results[0];
            console.log('Customer data:', customer);

            // Compare passwords directly (without hashing)
            const match = password === customer.password;
            console.log('Password match:', match);

            if (match) {
                req.session.customer_email = email;
                res.status(200).json({ message: 'Logged in successfully' });
            } else {
                res.status(401).json({ message: 'Incorrect email or password' });
            }
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    });
});


app.post('/team-login', async (req, res) => {
    const { teamName, password } = req.body;
    const query = 'SELECT * FROM teams WHERE team_name = ?';
    db.query(query, [teamName], async (err, results) => {
        if (err) {
            console.error('Error logging in:', err);
            res.status(500).json({ message: 'Login failed' });
        } else if (results.length > 0) {
            const team = results[0];
            const match = await bcryptjs.compare(password, team.password);
            if (match) {
                req.session.teamName = teamName;
                res.status(200).json({ message: 'Logged in successfully' });
            } else {
                res.status(401).json({ message: 'Incorrect team name or password' });
            }
        } else {
            res.status(404).json({ message: 'Team not found' });
        }
    });
});

const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
        headers: {
            'PLAID-CLIENT-ID': '65bad42d8868dc001c6498f7',
            'PLAID-SECRET': 'cd062f72389ec415a10315a12913df',
        },
    },
});
const client = new PlaidApi(configuration);

app.post('/api/create_link_token', async (req, res) => {
    const username = req.session.username;
    if (!username) {
        return res.status(400).json({ message: 'No user session found' });
    }
    try {
        const response = await client.linkTokenCreate({
            user: {
                client_user_id: username,
            },
            client_name: 'Plaid Test App',
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
        const response = await client.itemPublicTokenExchange({ public_token });
        const access_token = response.data.access_token;
        const item_id = response.data.item_id;
        console.log('Access Token: ', access_token);
        console.log('Exchanging link token for access token', response.data);
        res.json({ access_token, item_id });
    } catch (error) {
        console.error('Error exchanging public token:', error);
        res.status(500).json({ message: 'Error exchanging public token', error: error.message });
    }
});

app.get('/api/transactions', async (req, res) => {
    const access_token = req.query.access_token;
    const start_date = '2023-01-01';
    const end_date = '2024-12-31';
    const username = req.session.username;
    const user_id = req.session.user_id;
    let transactions = [];

    if (!access_token || !user_id) {
        return res.status(400).json({ message: 'Access token and user ID are required.' });
    }

    try {
        const response = await client.transactionsGet({
            access_token,
            start_date,
            end_date,
        });

        transactions = response.data.transactions;
        console.log('Transactions response:', response.data);

        transactions.forEach(transaction => {
            const { transaction_id, account_id, account_owner, amount, date, name, payment_channel, transaction_type, iso_currency_code, merchant_name } = transaction;
            const personal_finance_category = transaction.personal_finance_category ? transaction.personal_finance_category.primary : null;
            const confidence_level = transaction.personal_finance_category ? transaction.personal_finance_category.confidence_level : null;

            const query = 'INSERT INTO transactions (username, transaction_id, account_id, account_owner, amount, date, name, payment_channel, transaction_type, iso_currency_code, merchant_name, personal_finance_category, confidence_level, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount), date = VALUES(date)';

            db.query(query, [username, transaction_id, account_id, account_owner, amount, date, name, payment_channel, transaction_type, iso_currency_code, merchant_name, personal_finance_category, confidence_level, user_id], (err, result) => {
                if (err) {
                    console.error('Error inserting transaction:', err);
                } else {
                    console.log('Transaction inserted:', result);
                }
            });
        });

        console.log('Transactions:', transactions);
        res.json(transactions);
    } catch (error) {
        console.error('Error retrieving transactions:', error);
        res.status(500).json({ message: 'Error retrieving transactions', error: error.message });
    }
});

app.get('/api/total_spending_by_team', (req, res) => {
    const query = `
        SELECT
            u.favorite_team,
            SUM(t.amount) AS total_spending
        FROM
            users u
        JOIN
            transactions t ON u.username = t.username
        GROUP BY
            u.favorite_team
        ORDER BY
            total_spending DESC;
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching total spending by team:', err);
            res.status(500).json({ message: 'Error fetching data' });
        } else {
            res.json(results);
        }
    });
});

app.get('/api/transactions_by_payment_channel', (req, res) => {
    const query = `
        SELECT t.payment_channel, COUNT(*) AS transaction_count
        FROM users u
        JOIN transactions t ON u.username = t.username
        GROUP BY t.payment_channel
        ORDER BY transaction_count DESC;
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching transactions by payment channel:', err);
            res.status(500).json({ message: 'Error fetching data' });
        } else {
            res.json(results);
        }
    });
});

app.get('/api/transactions_by_team', (req, res) => {
    const { teamName } = req.query;

    if (!teamName) {
        return res.status(400).json({ message: 'Team name is required' });
    }

    const query = `
        SELECT
            t.payment_channel,
            COUNT(*) AS transaction_count
        FROM
            users u
        JOIN
            transactions t ON u.username = t.username
        WHERE
            u.favorite_team = ?
        GROUP BY
            t.payment_channel
        ORDER BY
            transaction_count DESC;
    `;

    db.query(query, [teamName], (err, results) => {
        if (err) {
            console.error('Error fetching transactions by team:', err);
            res.status(500).json({ message: 'Error fetching data' });
        } else {
            res.json(results);
        }
    });
});

app.use('/insights.html', (req, res, next) => {
    if (!req.session.customer_email) {
        return res.redirect('/login.html?type=customer');
    }
    next();
});

app.use('/homepage.html', (req, res, next) => {
    if (!req.session.username) {
        return res.redirect('/login.html');
    }
    next();
});


const stringSimilarity = require('string-similarity');

// Function to get the best match
const getBestMatch = (merchantName, sponsorNames) => {
    const matches = stringSimilarity.findBestMatch(merchantName, sponsorNames);
    const bestMatch = matches.bestMatch;
    return bestMatch.rating >= 0.6 ? bestMatch.target : null; // Use a threshold of 0.6 for fuzzy matching
};

const FAN_STATUS_MULTIPLIERS = {
    Fan: 1,
    'Super Fan': 2,
};

const LEAGUE_MULTIPLIERS = {
    MLB: 1,
    NBA: 1,
    NFL: 1,
};

const POINTS_PER_DOLLAR = 10;

const isEligibleFanStatus = (status) => ['Fan', 'Super Fan'].includes(status);

const getFanStatusForLeague = (league, transaction) => {
    switch (league) {
        case 'MLB':
            return transaction.mlb_fan_status;
        case 'NBA':
            return transaction.nba_fan_status;
        case 'NFL':
            return transaction.nfl_fan_status;
        default:
            return null;
    }
};

const normalizeAmount = (amount) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
        return 0;
    }
    return Math.max(0, numericAmount);
};

const calculateFanSpendPoints = (amount, fanStatus, league) => {
    const normalizedAmount = normalizeAmount(amount);
    const fanMultiplier = FAN_STATUS_MULTIPLIERS[fanStatus] || 0;
    if (!fanMultiplier || normalizedAmount === 0) {
        return { points: 0, multiplier: 0 };
    }

    const leagueMultiplier = LEAGUE_MULTIPLIERS[league] || 1;
    const combinedMultiplier = fanMultiplier * leagueMultiplier;
    const rawPoints = normalizedAmount * POINTS_PER_DOLLAR * combinedMultiplier;

    return {
        points: Math.round(rawPoints),
        multiplier: combinedMultiplier,
    };
};

const buildFanSpendSummary = (transactions) => {
    return transactions.reduce((acc, transaction) => {
        const points = transaction.fanspend_points || 0;
        if (!points) {
            return acc;
        }

        acc.total += points;
        const league = transaction.sponsor_league;
        if (league) {
            acc.byLeague[league] = (acc.byLeague[league] || 0) + points;
        }
        return acc;
    }, { total: 0, byLeague: {} });
};

app.get('/api/transactions_with_sponsors', (req, res) => {
    const username = req.session.username;

    if (!username) {
        return res.status(400).json({ message: 'No user session found' });
    }

    // Get the sponsor names from the sponsors table
    const sponsorQuery = 'SELECT merchant_name, league FROM sponsors';
    db.query(sponsorQuery, (err, sponsorResults) => {
        if (err) {
            console.error('Error fetching sponsors:', err);
            return res.status(500).json({ message: 'Error fetching sponsors data' });
        }

        const sponsors = sponsorResults.map(sponsor => sponsor.merchant_name);
        const sponsorMap = sponsorResults.reduce((acc, sponsor) => {
            acc[sponsor.merchant_name] = sponsor.league;
            return acc;
        }, {});

        const transactionQuery = `
            SELECT t.*, u.*
            FROM transactions t
            JOIN users u ON t.username = u.username
            WHERE u.username = ?
            ORDER BY t.date DESC;
        `;

        db.query(transactionQuery, [username], (err, transactionResults) => {
            if (err) {
                console.error('Error fetching transactions:', err);
                return res.status(500).json({ message: 'Error fetching transactions data' });
            }

            const matchedTransactions = transactionResults.reduce((acc, transaction) => {
                const bestMatch = getBestMatch(transaction.merchant_name, sponsors);
                if (!bestMatch) {
                    return acc;
                }

                const league = sponsorMap[bestMatch];
                const fanStatus = getFanStatusForLeague(league, transaction);

                if (!isEligibleFanStatus(fanStatus)) {
                    return acc;
                }

                const { points: fanspendPoints, multiplier: fanspendMultiplier } = calculateFanSpendPoints(transaction.amount, fanStatus, league);

                if (!fanspendPoints) {
                    return acc;
                }

                acc.push({
                    ...transaction,
                    matched_sponsor: bestMatch,
                    sponsor_league: league,
                    fanspend_points: fanspendPoints,
                    fanspend_multiplier: fanspendMultiplier,
                    fanspend_fan_status: fanStatus,
                });
                return acc;
            }, []);

            const summary = buildFanSpendSummary(matchedTransactions);

            res.json({
                summary,
                transactions: matchedTransactions,
            });
        });
    });
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
