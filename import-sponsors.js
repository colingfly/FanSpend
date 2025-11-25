const mysql = require('mysql2/promise');
const fs = require('fs');

async function importSponsors() {
    const connection = await mysql.createConnection('mysql://root:nraIQgRslLmkjyqSIEYbceqRquvrZoFz@turntable.proxy.rlwy.net:37018/railway');
    
    console.log('Connected to database!');
    
    const sql = fs.readFileSync('team-sponsors.sql', 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    
    for (const statement of statements) {
        if (statement.trim()) {
            try {
                await connection.execute(statement);
                console.log('✓ Executed statement');
            } catch (err) {
                // Ignore duplicate key errors
                if (err.code !== 'ER_DUP_ENTRY') {
                    console.error('Error:', err.message);
                }
            }
        }
    }
    
    await connection.end();
    console.log('\n✅ Team sponsors imported!');
}

importSponsors().catch(console.error);
