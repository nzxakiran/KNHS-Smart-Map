const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- MEMORY STORAGE (Holds the logs while server is running) ---
let alertHistory = [];

// --- MIDDLEWARE ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'knhs_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---
app.get('/', (req, res) => {
    if (req.session.role === 'admin') return res.redirect('/admin');
    if (req.session.role === 'student') return res.redirect('/student');
    res.sendFile(path.join(__dirname, 'public', 'login.html')); 
});

app.post('/auth', (req, res) => {
    const username = req.body.username ? req.body.username.trim() : '';
    const password = req.body.password ? req.body.password.trim() : '';
    
    if (username.toLowerCase() === 'admin' && password === 'knhs2026') {
        req.session.loggedin = true;
        req.session.role = 'admin';
        return res.redirect('/admin');
    }
    
    if (username.length > 0) {
        req.session.loggedin = true;
        req.session.role = 'student';
        req.session.username = username;
        return res.redirect('/student');
    }
    res.redirect('/?error=invalid_credentials');
});

app.get('/admin', (req, res) => {
    if (req.session.role === 'admin') res.sendFile(path.join(__dirname, 'admin.html'));
    else res.redirect('/');
});

app.get('/student', (req, res) => {
    if (req.session.role === 'student' || req.session.role === 'admin') res.sendFile(path.join(__dirname, 'index.html'));
    else res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SOCKET.IO EVENT HANDLERS (THE FIX IS HERE) ---
io.on('connection', (socket) => {
    console.log(`[SOCKET] User connected: ${socket.id}`);

    // 1. ADMIN CONNECTS: Send them the previous history immediately
    socket.emit('log-history', alertHistory);

    // 2. ADMIN TRIGGERS ALERT
    socket.on('broadcast-alert', (data) => {
        console.log(`[ALERT] Admin triggered: ${data.type}`);
        
        // A. Save to History
        const logEntry = { 
            type: data.type, 
            time: new Date().toLocaleTimeString() 
        };
        alertHistory.push(logEntry);

        // B. Tell Admin to update the Log UI
        io.emit('update-logs', logEntry);

        // C. Tell Students to panic (or relax)
        io.emit('receive-alert', data);
    });

    // 3. STUDENT MARKS SAFE
    socket.on('student-status', (data) => {
        console.log(`[SAFE] Student ${data.id} is safe.`);
        // Forward this info to the Admin Dashboard
        io.emit('admin-dashboard-update', data);
    });

    // 4. STUDENT SENDS NOTE
    socket.on('student-note', (data) => {
        console.log(`[NOTE] Message from ${data.id}: ${data.message}`);
        // Forward this note to the Admin Dashboard
        io.emit('admin-note-receive', data);
    });

    // 5. STUDENT LOGIN REGISTRATION
    socket.on('register-student', (studentId) => {
        console.log(`[REG] Student Registered: ${studentId}`);
    });

    // 6. ADMIN REPLIES TO STUDENT (Add this to server.js)
    socket.on('admin-reply', (data) => {
        console.log(`[REPLY] Admin acknowledged Student ${data.targetId}`);
        // Broadcast to all, but client side will filter by ID
        io.emit('receive-reply', data);
    });
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ SERVER READY! Access here: http://localhost:${PORT}`);
});