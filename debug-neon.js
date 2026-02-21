// debug-neon.js — inspect exact DB state and error
require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');
    console.log('URL (masked):', dbUrl.replace(/:([^:@]+)@/, ':***@'));

    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('✅ Connected\n');

    // List enums
    const enums = await client.query(`SELECT typname FROM pg_type WHERE typcategory='E' ORDER BY typname`);
    console.log('Enums:', enums.rows.map(r => r.typname).join(', ') || 'none');

    // List tables  
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', ') || 'none');

    // Try creating users table
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(120) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(20),
                password_hash TEXT NOT NULL,
                role user_role NOT NULL DEFAULT 'citizen',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        console.log('\n✅ users table created!');
    } catch (e) {
        console.log('\n❌ users creation error:', e.message);
        console.log('   Code:', e.code);
    }

    await client.end();
}
run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
