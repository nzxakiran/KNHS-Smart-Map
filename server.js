const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- MEMORY STORAGE ---
let alertHistory = [];

// --- 1. MOCK DATABASE (WHITELIST WITH PASSWORDS) ---
// Admin can manage credentials here.
const registeredStudents = [
    { id: "2024-001", password: "user1", name: "Juan Dela Cruz" },
    { id: "2024-002", password: "user2", name: "Maria Clara" },
    { id: "2024-003", password: "user3", name: "Jose Rizal" },
    { id: "TEST-ADMIN", name: "Admin Test" } 
];

// --- MIDDLEWARE ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'knhs_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---

// 1. ROOT ROUTE (The Gatekeeper)
app.get('/', (req, res) => {
    // If session exists, redirect to correct dashboard
    if (req.session.role === 'admin') return res.redirect('/admin');
    if (req.session.role === 'student') return res.redirect('/student');
    
    // Otherwise, show the Login Page
    res.sendFile(path.join(__dirname, 'public', 'login.html')); 
});

// 2. UNIFIED AUTHENTICATION ROUTE (Admin & Student)
app.post('/auth', (req, res) => {
    const username = req.body.username ? req.body.username.trim() : '';
    const password = req.body.password ? req.body.password.trim() : '';
    
    // A. CHECK ADMIN LOGIN
    if (username.toLowerCase() === 'admin' && password === 'password') {
        req.session.loggedin = true;
        req.session.role = 'admin';
        console.log(`[AUTH] Admin Logged In`);
        return res.redirect('/admin');
    }
    
    // B. CHECK STUDENT LOGIN
    // Find student matching BOTH ID and Password
    const student = registeredStudents.find(s => s.id === username && s.password === password);

    if (student) {
        req.session.loggedin = true;
        req.session.role = 'student';
        req.session.username = student.name;
        req.session.studentId = student.id;
        console.log(`[AUTH] Student Logged In: ${student.name}`);
        return res.redirect('/student');
    }

    // C. FAILED LOGIN
    console.log(`[AUTH] Failed Attempt: ${username}`);
    res.redirect('/?error=invalid_credentials');
});

// 3. API TO GET CURRENT USER INFO (For Student Dashboard)
app.get('/api/me', (req, res) => {
    if (req.session.role === 'student') {
        res.json({ id: req.session.studentId, name: req.session.username });
    } else {
        res.status(401).json({ error: "Not logged in" });
    }
});

// 4. VERIFICATION ROUTE (Legacy/Alternative Check)
// Kept for compatibility if you use the ID-only checker elsewhere
app.post('/verify-student', (req, res) => {
    const attemptedID = req.body.studentID;
    const student = registeredStudents.find(s => s.id === attemptedID);
    if (student) {
        res.json({ success: true, name: student.name });
    } else {
        res.json({ success: false });
    }
});

// 5. PROTECTED PAGES
app.get('/admin', (req, res) => {
    if (req.session.role === 'admin') res.sendFile(path.join(__dirname, 'public','admin.html'));
    else res.redirect('/');
});

app.get('/student', (req, res) => {
    if (req.session.role === 'student' || req.session.role === 'admin') {
        // Ensure this file exists in your MAIN folder or update path to 'public/index.html'
        res.sendFile(path.join(__dirname, 'public', 'student.html')); 
    } else {
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    console.log(`[SOCKET] User connected: ${socket.id}`);

    // 1. ADMIN CONNECTS
    socket.emit('log-history', alertHistory);

    // 2. ADMIN TRIGGERS ALERT
    socket.on('broadcast-alert', (data) => {
        console.log(`[ALERT] Admin triggered: ${data.type}`);
        const logEntry = { type: data.type, time: new Date().toLocaleTimeString() };
        alertHistory.push(logEntry);
        io.emit('update-logs', logEntry);
        io.emit('receive-alert', data);
    });

    // 3. STUDENT MARKS SAFE
    socket.on('student-status', (data) => {
        console.log(`[SAFE] Student ${data.id} is safe.`);
        io.emit('admin-dashboard-update', data);
    });

    // 4. STUDENT SENDS NOTE
    socket.on('student-note', (data) => {
        console.log(`[NOTE] Message from ${data.id}: ${data.message}`);
        io.emit('admin-note-receive', data);
    });

    // 5. STUDENT REGISTRATION (UPDATED FOR PRIVATE ROOMS)
    socket.on('register-student', (studentId) => {
        // Essential: Student joins a room with their own ID
        socket.join(studentId);
        console.log(`[REG] Student joined private channel: ${studentId}`);
    });

    // 6. ADMIN REPLIES TO STUDENT (UPDATED FOR CONFIRM BUTTON)
    // Inside server.js
    socket.on('admin-reply', (data) => {
        console.log(`[REPLY] Admin acknowledged Student ${data.targetId}`);
        
        // BROADCAST to everyone (Student side will filter it)
        io.emit('receive-reply', {
            targetId: data.targetId,
            message: data.message
        });
    });
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ SERVER READY! Access here: http://localhost:${PORT}`);
});