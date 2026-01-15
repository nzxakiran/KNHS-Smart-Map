const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. SETUP ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'knhs_secret_key_2026',
    resave: true,
    saveUninitialized: true
}));

// Serve static files (css, js, images) if you have a 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. STORAGE (The Memory) ---
// This variable keeps the logs as long as the server is running
let alertHistory = []; 

// --- 3. ROUTES ---
// Serve the main student page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Handle Login Logic
app.post('/auth', (req, res) => {
    const { username, password } = req.body;
    // Simple hardcoded check
    if (username === 'admin' && password === 'knhs2026') {
        req.session.loggedin = true;
        res.redirect('/admin');
    } else {
        res.redirect('/login?error=true');
    }
});

// Serve the Admin Dashboard (protected)
app.get('/admin', (req, res) => {
    if (req.session.loggedin) {
        res.sendFile(path.join(__dirname, 'admin.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- 4. SOCKET LOGIC (FIXED) ---
io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // --- A. INITIALIZATION ---
    // Send existing history to the new person (Admin needs this)
    socket.emit('log-history', alertHistory);

    // --- B. ADMIN COMMANDS ---
    // Listen for Admin triggering an alert
    // Note: Changed 'trigger-alert' to 'broadcast-alert' to match your admin.html
    socket.on('broadcast-alert', (data) => {
        console.log("Admin triggered:", data.type);

        // 1. Create a timestamp
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { type: data.type, time: timestamp, message: data.message };

        // 2. Save to Server Memory
        alertHistory.unshift(logEntry); // Add to top of list
        if(alertHistory.length > 50) alertHistory.pop(); // Keep only last 50

        // 3. Send to ALL Students (Turn phones red)
        io.emit('receive-alert', data);

        // 4. Send back to Admin (Update the log list)
        io.emit('update-logs', logEntry);
    });

    // --- C. STUDENT UPDATES ---
    
    // When student opens the app
    socket.on('register-student', (studentId) => {
        console.log(`Student ${studentId} registered`);
        socket.join('students');
    });

    // When student clicks "I AM SAFE"
    socket.on('student-status', (data) => {
        console.log(`SAFE UPDATE: ${data.id}`);
        // Forward this to the Admin Dashboard Panel
        io.emit('admin-dashboard-update', data); 
    });

    // When student sends a note
    socket.on('student-note', (data) => {
        console.log(`NOTE from ${data.id}: ${data.message}`);
        // Forward this to the Admin Dashboard Panel
        io.emit('admin-note-receive', data);
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`-----------------------------------`);
    console.log(`✅ SERVER RUNNING! Access it here:`);
    console.log(`👉 STUDENT VIEW: http://localhost:${PORT}`);
    console.log(`👉 ADMIN PANEL:  http://localhost:${PORT}/admin`);
    console.log(`-----------------------------------`);
});