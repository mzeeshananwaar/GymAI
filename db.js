const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-xxxxx.aivencloud.com',
  user: process.env.DB_USER || 'avnadmin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'defaultdb',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 20028,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: { rejectUnauthorized: false }   // <--- YEH LINE ADD KARO
});

module.exports = pool;