const express = require('express');
const pool = require("./db");
const path = require('path');
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
          content: `You are GymAI, a friendly gym coach from Pakistan. 
          STRICT RULES:
          1. Speak ONLY in a mix of simple Roman Urdu and English (Hinglish/Urdu-ish).
          2. Use simple words like 'brother', 'koshish', 'behtar', 'exercise'.
          3. STRICTLY FORBIDDEN: Do not use Hindi words like 'shuddh', 'dhanyavaad', 'prashikshan'. 
          4. Keep the tone very casual, like a gym bro.
          5. Max 1-2 short sentences only.` 
        },
        { role: "user", content: message }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.7, // Is se AI zyada "robotic" nahi lagta
      max_tokens: 100   // Is se reply lamba nahi hoga
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("AI Error:", error);
    res.json({ reply: "Sorry brother, the AI server is busy right now. Try again later! 💪" });
  }
});



// Public route for landing page counter
app.get('/api/public-user-count', async (req, res) => {
  try {
    const [result] = await pool.query(
      "SELECT COUNT(*) AS total FROM users"
    );

    res.json({ count: result[0].total });

  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});





// --- USER AUTHENTICATION: SIGNUP ---
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 🔐 password hash
    const hash = await bcrypt.hash(password, 10);

    // 💾 insert user
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
      [name, email, hash, "user"]
    );

    // 🧠 session set
    req.session.user = {
      id: result.insertId,
      name: name,
      role: "user",
    };

    res.status(200).send("Success");

  } catch (err) {
    console.error("SIGNUP ERROR:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .send("Email already registered. Please login.");
    }

    res.status(500).send("Database error.");
  }
});

 
// --- LOGIN ROUTE ---
// --- USER AUTHENTICATION: LOGIN ---
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // 🔍 user find karo
    const [results] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    // ❌ user nahi mila
    if (results.length === 0) {
      return res.status(401).send("User not found.");
    }

    const user = results[0];

    // 🔐 password compare
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).send("Wrong password.");
    }

    // 🧠 session set
    req.session.user = {
      id: user.id,
      name: user.name,
      role: user.role,
      goal: user.goal
    };

    // 💾 session save
    req.session.save((err) => {
      if (err) {
        console.error("SESSION ERROR:", err);
        return res.status(500).send("Session Error");
      }

      console.log("Session saved for user:", user.name);

      res.json({
        success: true,
        redirectTo: (!user.goal || user.goal === "") 
  ? "/onboarding.html" 
  : "/dashboard.html"
      });
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).send("Database Error");
  }
});


//onboarding
app.post('/save-onboarding', async (req, res) => {
    const { goal, diet, height, weight, experience } = req.body;

    try {
        // check session
        if (!req.session.user) {
            return res.redirect('/login.html');
        }

        const userId = req.session.user.id;

        // update DB
        await pool.query(
            "UPDATE users SET goal = ?, diet_type = ?, experience = ?, height = ?, weight = ? WHERE id = ?",
            [goal, diet, experience, height, weight, userId]
        );

        // update session
        req.session.user.goal = goal;
        req.session.user.diet = diet;

        // redirect
        res.redirect('/dashboard.html');

    } catch (err) {
        console.error("ONBOARDING ERROR:", err);
        res.status(500).send("Error updating fitness profile.");
    }
});

// --- ADMIN PANEL ---
app.get('/users', isAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      "SELECT id, name, email, role, goal, diet_type FROM users"
    );

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
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
app.post("/fitness-log", async (req, res) => {
  try {
    // Frontend se 'workout' aa raha hai, usay 'exercise_name' mein map karna hai
    const { user_id, weight, workout } = req.body;

    console.log("Saving for user:", user_id, "Weight:", weight, "Workout:", workout);

    if (!user_id || !weight) {
      return res.status(400).json({ error: "Missing data" });
    }

    await pool.query(
      "INSERT INTO fitness_logs (user_id, weight, exercise_name, date) VALUES (?, ?, ?, NOW())",
      [user_id, weight, workout]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("DB Error:", err.message);
    res.status(500).json({ error: "Database Error", details: err.message });
  }
});

// --- STATS ---
app.get("/stats", async (req, res) => {
  try {
    const [result] = await pool.query(
      "SELECT COUNT(*) AS total FROM users"
    );

    res.json(result[0]);

  } catch (err) {
    res.status(500).json(err);
  }
});


// --- FITNESS DATA FOR GRAPH ---
app.get("/fitness-data", async (req, res) => {
  try {
    // Always use session user ID for security
    const userId = req.session.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const [logs] = await pool.query(
      "SELECT weight, date FROM fitness_logs WHERE user_id = ? ORDER BY date ASC",
      [userId]
    );

    res.json(logs);
  } catch (err) {
    console.error("Fitness data error:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});



// --- LOGOUT ---
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
    res.clearCookie('connect.sid', {
     path: '/'
    });
        res.redirect('/login.html');
    });
});


const { Parser } = require('json2csv'); // Top par add karein

// --- EXPORT USERS TO CSV ---
app.get('/export-users', isAdmin, async (req, res) => {
  try {
    const [results] = await pool.query(
      "SELECT id, name, email, role FROM users"
    );

    const fields = ['id', 'name', 'email', 'role'];
    const parser = new Parser({ fields });
    const csv = parser.parse(results);

    res.header('Content-Type', 'text/csv');
    res.attachment('GymAI_Users_Report.csv');
    res.send(csv);

  } catch (err) {
    res.status(500).send("Database Error");
  }
});


// --- DELETE USER ROUTE ---
app.get('/delete/:id', isAdmin, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM users WHERE id = ?",
      [req.params.id]
    );

    res.redirect('/admin.html');

  } catch (err) {
    res.status(500).send("Delete error");
  }
});

// --- 1. Edit Form ke liye User ka purana data mangwana ---
// --- USER MANAGEMENT (EDIT & UPDATE) ---

// 1. Get User Data for Edit Form
app.get('/user/:id', async (req, res) => {
  try {
    const [result] = await pool.query(
      "SELECT id, name, email, phone, role FROM users WHERE id = ?",
      [req.params.id]
    );

    if (!result.length) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result[0]);

  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// 2. Update User Data
// 2. Update User Data
// --- USER MANAGEMENT (UPDATE) ---
app.post('/update/:id', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id; // Yeh line missing thi aapki image mein
    const { name, email, phone, role } = req.body;

    // UPDATE Query
    await pool.query(
      "UPDATE users SET name=?, email=?, phone=?, role=? WHERE id=?",
      [name, email, phone, role, userId]
    );

    res.status(200).send("Updated successfully!");

  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).send("Database error occurred.");
  }
});

// Server listen logic
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GymAI Server running on port ${PORT}...`);
});