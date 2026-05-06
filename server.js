const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();
require('dotenv').config(); 
const Groq = require("groq-sdk");

// --- SESSION CONFIGURATION ---
app.use(session({
  secret: "gym_secret_key",
  resave: true,                
  saveUninitialized: true,     
  cookie: { 
    secure: false,             
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE CONNECTION ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 20028,
    ssl: {
        rejectUnauthorized: false // Online connection (Aiven) ke liye ye zaroori hai
    }
});

db.connect((err) => {
  if (err) {
    console.log("❌ Database Connection Failed:", err);
  } else {
    console.log("✅ Database Connected Successfully");
  }
});

// --- GROQ AI SETUP ---
const groq = new Groq({ 
    apiKey: process.env.GROQ_API_KEY 
});



// --- MIDDLEWARE: ADMIN CHECK ---
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        return res.status(403).send("<h1>403 Forbidden</h1><p>Access Denied: Admin privileges required.</p>");
    }
}

// --- AI CHATBOT ROUTE ---
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "You are GymAI, a professional fitness coach. Help users with workout and diet. Respond ONLY in a mix of Roman Urdu and English but don't in hidni. Keep answers short (max 2 sentences)." 
        },
        { role: "user", content: message }
      ],
      model: "llama-3.1-8b-instant", 
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("AI Error:", error);
    res.json({ reply: "Sorry brother, the AI server is busy right now. Try again later! 💪" });
  }
});



// Public route for landing page counter
app.get('/api/public-user-count', (req, res) => {
    const sql = "SELECT COUNT(*) AS total FROM users";
    db.query(sql, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({ count: result[0].total });
    });
});






//--- USER AUTHENTICATION: SIGNUP ---
app.post('/signup', (req, res) => {
    const { name, email, password } = req.body;
    
    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).send("Security error.");
        
        const sql = "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)";
        db.query(sql, [name, email, hash, 'user'], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    // 400 status bhejein taake frontend error catch kare
                    return res.status(400).send("Email already registered. Please login.");
                }
                return res.status(500).send("Database error.");
            }
            
            req.session.user = { id: result.insertId, name: name, role: 'user' };
            // Success par 200 status bhejein
            res.status(200).send("Success");
        });
    });
});



 
// --- LOGIN ROUTE ---
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    db.query("SELECT * FROM users WHERE email = ?", [email], (err, results) => {
        if (err) return res.status(500).send("Database Error");
        
        // 401 status code use karein taake frontend catch kar sakay
        if (results.length === 0) return res.status(401).send("User not found.");

        const user = results[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (isMatch) {
                req.session.user = { 
                    id: user.id, 
                    name: user.name, 
                    role: user.role, 
                    goal: user.goal 
                };

                req.session.save((err) => {
                    if (err) return res.status(500).send("Session Error");
                    
                    console.log("Session saved for user:", req.session.user.name);
                    
                    // Yahan res.redirect ki jagah JSON bhejein
                    res.json({ 
                        success: true, 
                        redirectTo: !user.goal ? '/onboarding.html' : '/dashboard.html' 
                    });
                });
            } else {
                // Wrong password par 401 status
                res.status(401).send("Wrong password.");
            }
        });
    });
});

// --- ONBOARDING ---
app.post('/save-onboarding', (req, res) => {
    const { goal, diet, height, weight, experience } = req.body;
    
    if (!req.session.user) {
        return res.redirect('/login.html');
    }

    const userId = req.session.user.id;
    const sql = "UPDATE users SET goal = ?, diet_type = ?, experience = ?, height = ?, weight = ? WHERE id = ?";
    
    db.query(sql, [goal, diet, experience, height, weight, userId], (err) => {
        if (err) return res.status(500).send("Error updating fitness profile.");
        
        req.session.user.goal = goal;
        req.session.user.diet = diet;
        
        res.redirect('/dashboard.html');
    });
});

// --- ADMIN PANEL ---
app.get('/users', isAdmin, (req, res) => {
    const sql = "SELECT id, name, email, role, goal, diet_type FROM users";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: "Failed to retrieve user database." });
        res.json(result);
    });
});

// --- CURRENT USER ---
app.get('/api/current-user', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.json({ id: null });
    }
});

// --- FITNESS LOGGING ---
app.post('/fitness-log', (req, res) => {
    const { user_id, weight, workout } = req.body;
    const sql = "INSERT INTO fitness_logs (user_id, weight, exercise_name) VALUES (?, ?, ?)";
    
    db.query(sql, [user_id, weight, workout], (err, result) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        
        // Blank page ki jagah 200 OK status bhejein
        res.status(200).json({ message: "Success " });
    });
});

app.get('/fitness-data', (req, res) => {
    if (!req.session.user) return res.status(401).send("Unauthorized access.");
    
    const sql = "SELECT weight, date FROM fitness_log WHERE user_id = ? ORDER BY date ASC";
    db.query(sql, [req.session.user.id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

// --- STATS ---
app.get('/stats', (req, res) => {
    db.query("SELECT COUNT(*) AS total FROM users", (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result[0]);
    });
});

// --- LOGOUT ---
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('connect.sid');
        res.redirect('/login.html');
    });
});


const { Parser } = require('json2csv'); // Top par add karein

// --- EXPORT USERS TO CSV ---
app.get('/export-users', isAdmin, (req, res) => {
    const sql = "SELECT id, name, email, role FROM users";
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Database Error during export.");
        }

        try {
            const fields = ['id', 'name', 'email', 'role'];
            const opts = { fields };
            const parser = new Parser(opts);
            const csv = parser.parse(results);

            // Browser ko batana ke yeh file download karni hai
            res.header('Content-Type', 'text/csv');
            res.attachment('GymAI_Users_Report.csv');
            return res.send(csv);
        } catch (err) {
            console.error(err);
            res.status(500).send("Cannot export CSV");
        }
    });
});


// --- DELETE USER ROUTE ---
app.get('/delete/:id', isAdmin, (req, res) => {
    const userId = req.params.id;

    // Database se user delete karne ki query
    const sql = "DELETE FROM users WHERE id = ?";
    
    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.error("Error deleting user:", err);
            return res.status(500).send("User delete karne mein masla hua.");
        }
        
        console.log(`User with ID ${userId} deleted by Admin.`);
        
        // Delete hone ke baad wapis admin panel par bhej dein
        res.redirect('/admin.html');
    });
});

// --- 1. Edit Form ke liye User ka purana data mangwana ---
// --- USER MANAGEMENT (EDIT & UPDATE) ---

// 1. Get User Data for Edit Form
app.get('/user/:id', (req, res) => {
    const userId = req.params.id;
    // Note: Agar error aaye toh temporarily yahan se 'isAdmin' hata kar check karein
    const sql = "SELECT id, name, email, phone, role FROM users WHERE id = ?";
    
    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.error("❌ DB Error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(result[0]); 
    });
});

// 2. Update User Data
app.post('/update/:id', (req, res) => {
    const userId = req.params.id;
    const { name, email, phone, role } = req.body;

    const sql = "UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?";
    
    db.query(sql, [name, email, phone, role, userId], (err, result) => {
        if (err) {
            console.error("❌ Update Error:", err);
            return res.status(500).send("Update fail ho gaya.");
        }
        
        console.log(`✅ User ID ${userId} updated successfully!`);
        res.redirect('/admin.html'); 
    });
});

// --- 2. Form submit hone par data update karna ---
app.post('/update/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    const { name, email, phone, role } = req.body;

    const sql = "UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?";
    
    db.query(sql, [name, email, phone, role, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Update fail ho gaya.");
        }
        
        // Update ke baad wapis Admin Panel par bhej dein
        res.redirect('/admin.html');
    });
});

const PORT = 3000;
app.listen(PORT, () => {
console.log(`GymAI Server running at https://gymai-ten.vercel.app`);
});