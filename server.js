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

    // 🔁 Check if user has completed onboarding (profile exists in new table)
    const [profileRows] = await pool.query(
      "SELECT user_id FROM user_fitness_profiles WHERE user_id = ?",
      [user.id]
    );
    const hasProfile = profileRows.length > 0;

    // 💾 session save
    req.session.save((err) => {
      if (err) {
        console.error("SESSION ERROR:", err);
        return res.status(500).send("Session Error");
      }

      console.log("Session saved for user:", user.name);

      res.json({
        success: true,
        redirectTo: hasProfile ? "/dashboard.html" : "/onboarding.html"
      });
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).send("Database Error");
  }
});

//onboarding
// ============================================
// ONBOARDING SAVE (using user_fitness_profiles table)
// ============================================
app.post('/save-onboarding', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login.html');
        }
        const userId = req.session.user.id;

        console.log("Received onboarding data:", req.body);

        const {
            fitness_goal, body_type, height_cm, weight_kg, age, gender,
            experience_level, workout_days_per_week, session_duration_mins,
            workout_location, diet_type
        } = req.body;

        // Validation
        if (!fitness_goal || !body_type || !diet_type || !height_cm || !weight_kg) {
            console.log("Missing required fields");
            return res.status(400).send("Missing required fields");
        }

        // Insert or update into user_fitness_profiles
        await pool.query(`
            INSERT INTO user_fitness_profiles 
            (user_id, fitness_goal, body_type, height_cm, weight_kg, age, gender,
             experience_level, workout_days_per_week, session_duration_mins,
             workout_location, diet_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            fitness_goal = VALUES(fitness_goal),
            body_type = VALUES(body_type),
            height_cm = VALUES(height_cm),
            weight_kg = VALUES(weight_kg),
            age = VALUES(age),
            gender = VALUES(gender),
            experience_level = VALUES(experience_level),
            workout_days_per_week = VALUES(workout_days_per_week),
            session_duration_mins = VALUES(session_duration_mins),
            workout_location = VALUES(workout_location),
            diet_type = VALUES(diet_type),
            updated_at = NOW()
        `, [userId, fitness_goal, body_type, height_cm, weight_kg, age, gender,
            experience_level, workout_days_per_week, session_duration_mins,
            workout_location, diet_type]);

        // Also update users table goal for backward compatibility (optional)
        await pool.query("UPDATE users SET goal = ? WHERE id = ?", [fitness_goal, userId]);

        console.log("Onboarding data saved for user:", userId);
        res.redirect('/dashboard.html');

    } catch (err) {
        console.error("ONBOARDING SAVE ERROR:", err);
        res.status(500).send("Database error: " + err.message);
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

// ============================================
// NEW ONBOARDING & WORKOUT TRACKING APIs
// ============================================

// Check if user has completed onboarding (profile exists)
app.get('/api/onboarding/status', async (req, res) => {
    try {
        if (!req.session.user) return res.json({ completed: false });
        const userId = req.session.user.id;
        const [rows] = await pool.query(
            "SELECT user_id FROM user_fitness_profiles WHERE user_id = ?",
            [userId]
        );
        res.json({ completed: rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.json({ completed: false });
    }
});

// Save onboarding data into user_fitness_profiles


// Get user fitness profile (for dashboard)
app.get('/api/user-profile', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
        const userId = req.session.user.id;
        const [rows] = await pool.query(
            "SELECT * FROM user_fitness_profiles WHERE user_id = ?",
            [userId]
        );
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save workout completion for a day
app.post('/api/workout/complete', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
        const userId = req.session.user.id;
        const { date, day_name, exercises_completed, total_exercises, status } = req.body;

        await pool.query(`
            INSERT INTO workout_completions 
            (user_id, date, day_name, exercises_completed, total_exercises, status, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            exercises_completed = VALUES(exercises_completed),
            total_exercises = VALUES(total_exercises),
            status = VALUES(status),
            completed_at = NOW()
        `, [userId, date, day_name, JSON.stringify(exercises_completed), total_exercises, status]);

        // Update streak
        await updateUserStreak(userId, date, status === 'completed');

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get all workout completions for a user
app.get('/api/workout/completions', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
        const userId = req.session.user.id;
        const [rows] = await pool.query(
            "SELECT * FROM workout_completions WHERE user_id = ? ORDER BY date DESC",
            [userId]
        );
        // Parse JSON strings back to arrays
        rows.forEach(row => {
            if (row.exercises_completed) row.exercises_completed = JSON.parse(row.exercises_completed);
            else row.exercises_completed = [];
        });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get streak data
app.get('/api/workout/streak', async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
        const userId = req.session.user.id;
        const [rows] = await pool.query(
            "SELECT * FROM user_streaks WHERE user_id = ?",
            [userId]
        );
        if (rows.length === 0) {
            return res.json({ current_streak: 0, longest_streak: 0 });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper function to update streak (MySQL version)
async function updateUserStreak(userId, workoutDate, isCompleted) {
    if (!isCompleted) return;
    const today = new Date(workoutDate);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get current streak record
    const [streakRows] = await pool.query(
        "SELECT * FROM user_streaks WHERE user_id = ?",
        [userId]
    );

    let currentStreak = 1;
    let streakStartDate = today;
    let longestStreak = 1;

    if (streakRows.length > 0) {
        const lastDate = new Date(streakRows[0].last_workout_date);
        const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
            currentStreak = streakRows[0].current_streak + 1;
            streakStartDate = streakRows[0].streak_start_date;
        } else if (diffDays === 0) {
            // Same day, no change
            return;
        }
        longestStreak = Math.max(currentStreak, streakRows[0].longest_streak);
    } else {
        longestStreak = 1;
    }

    await pool.query(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_workout_date, streak_start_date, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
        current_streak = VALUES(current_streak),
        longest_streak = VALUES(longest_streak),
        last_workout_date = VALUES(last_workout_date),
        streak_start_date = VALUES(streak_start_date),
        updated_at = NOW()
    `, [userId, currentStreak, longestStreak, today, streakStartDate]);
}