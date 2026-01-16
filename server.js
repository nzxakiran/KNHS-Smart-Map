const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- ALLOW MOBILE APP & LAPTOP CONNECTION (CORS) ---
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- 1. SETUP ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'knhs_secret_key_2026',
    resave: true,
    saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- 2. STORAGE ---
let alertHistory = []; 

// --- 3. ROUTES ---

// ROOT: Now serves the Login Page first
app.get('/', (req, res) => {
    // If already logged in, redirect to their respective page
    if (req.session.role === 'admin') {
        return res.redirect('/admin');
    } else if (req.session.role === 'student') {
        return res.redirect('/student');
    }
    // Otherwise, show login
    res.sendFile(path.join(__dirname, 'login.html'));
});

// AUTH: Handles both Student and Admin logins
app.post('/auth', (req, res) => {
    const { username, password } = req.body;

    // ADMIN LOGIN CHECK
    if (username === 'admin' && password === 'knhs2026') {
        req.session.loggedin = true;
        req.session.role = 'admin'; // Mark session as Admin
        req.session.username = username;
        res.redirect('/admin');
    } 
    // STUDENT LOGIN CHECK (Accepts any other username for now, or add specific logic)
    else if (username && username !== 'admin') {
        req.session.loggedin = true;
        req.session.role = 'student'; // Mark session as Student
        req.session.username = username;
        res.redirect('/student');
    } 
    // FAILED LOGIN
    else {
        res.redirect('/?error=true'); // Redirect back to root with error
    }
});

// ADMIN DASHBOARD (Protected)
app.get('/admin', (req, res) => {
    if (req.session.loggedin && req.session.role === 'admin') {
        res.sendFile(path.join(__dirname, 'admin.html'));
    } else {
        res.redirect('/'); // Send back to login if not allowed
    }
});

// STUDENT DASHBOARD (Protected - Moved from '/')
app.get('/student', (req, res) => {
    // Check if logged in AND is a student (or allow admins to view student view too if desired)
    if (req.session.loggedin) { 
        // Use index.html as the student dashboard
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.redirect('/');
    }
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 4. SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // Send history to whoever connects (Admin or Student)
    socket.emit('log-history', alertHistory);

    // Admin sends Alert
    socket.on('broadcast-alert', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { type: data.type, time: timestamp, message: data.message };

        alertHistory.unshift(logEntry);
        if(alertHistory.length > 50) alertHistory.pop();

        io.emit('receive-alert', data);
        io.emit('update-logs', logEntry);
    });

    // Student Updates
    socket.on('register-student', (studentId) => {
        console.log(`Student ${studentId} registered`);
        socket.join('students');
    });

    socket.on('student-status', (data) => {
        io.emit('admin-dashboard-update', data); 
    });

    socket.on('student-note', (data) => {
        io.emit('admin-note-receive', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ SERVER RUNNING on port ${PORT}`);
    console.log(`   - Login:   http://localhost:${PORT}/`);
    console.log(`   - Student: http://localhost:${PORT}/student`);
    console.log(`   - Admin:   http://localhost:${PORT}/admin`);
});