const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const { createClient } = require('@supabase/supabase-js'); // Added Supabase

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- 1. SUPABASE CONNECTION ---
// Replace these with your actual credentials from Supabase Settings -> API
const SUPABASE_URL = 'https://dmomqmfqvfjvxswpgwge.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtb21xbWZxdmZqdnhzd3Bnd2dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NTk1MjksImV4cCI6MjA4NTEzNTUyOX0.Ij3zwZX7Zqn_IMeSKVoeJbE9gl06qmbvoFXtiLWUv3E';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// UPDATED LOGIN: Checks Supabase instead of memory array
app.post('/auth/login', async (req, res) => {
    const username = req.body.username ? req.body.username.trim() : '';
    const password = req.body.password ? req.body.password.trim() : '';
    
    // A. ADMIN LOGIN (Hardcoded for security)
    if (username.toLowerCase() === 'admin' && password === 'knhs2026') {
        req.session.loggedin = true;
        req.session.role = 'admin';
        return res.redirect('/admin');
    }
    
    // B. STUDENT LOGIN (Real Database Check)
    const { data: student, error } = await supabase
        .from('students')
        .select('*')
        .eq('student_id', username)
        .eq('password', password)
        .single();

    if (student) {
        req.session.loggedin = true;
        req.session.role = 'student';
        req.session.username = student.name;
        req.session.studentId = student.student_id;
        return res.redirect('/student');
    }

    res.redirect('/?error=invalid_credentials');
});

// UPDATED REGISTER: Saves new student to Supabase
app.post('/auth/register', async (req, res) => {
    const newId = req.body.username ? req.body.username.trim() : '';
    const newPassword = req.body.password ? req.body.password.trim() : '';
    const newName = req.body.fullname ? req.body.fullname.trim() : 'New Student';

    if (!newId || !newPassword) return res.redirect('/register.html?error=missing_fields');

    const { error } = await supabase
        .from('students')
        .insert([{ student_id: newId, password: newPassword, name: newName }]);

    if (error) {
        console.error("Registration Error:", error.message);
        return res.redirect('/register.html?error=user_already_exists');
    }

    res.redirect('/?success=registered');
});

app.get('/api/me', (req, res) => {
    if (req.session.role === 'student') {
        res.json({ id: req.session.studentId, name: req.session.username });
    } else {
        res.status(401).json({ error: "Not logged in" });
    }
});

// PROTECTED PAGES
app.get('/admin', (req, res) => {
    if (req.session.role === 'admin') res.sendFile(path.join(__dirname, 'public','admin.html'));
    else res.redirect('/');
});

app.get('/student', (req, res) => {
    if (req.session.role === 'student' || req.session.role === 'admin') {
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
// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', async (socket) => {
    console.log(`[SOCKET] User connected: ${socket.id}`);

    // Fetch history from Supabase on connect
    const { data: logs } = await supabase.from('disaster_logs').select('*').order('created_at', { ascending: false });
    socket.emit('log-history', logs || []);

    // ADMIN TRIGGERS ALERT
    socket.on('broadcast-alert', async (data) => {
        const { data: newLog, error } = await supabase
            .from('disaster_logs')
            .insert([{ type: data.type }])
            .select()
            .single();

        if (!error) {
            io.emit('update-logs', { type: newLog.type, time: new Date(newLog.created_at).toLocaleTimeString() });
            io.emit('receive-alert', data);
        }
    });

    // STUDENT SENDS A MESSAGE/NOTE TO ADMIN
    socket.on('student-note', (data) => {
        console.log(`[MESSAGE] From ${data.id}: ${data.message}`);
        
        // --- FIX: AUTO-JOIN THE ROOM ---
        // If the student sends a message, ensure they are in their own room so they get the reply
        socket.join(data.id); 
        console.log(`[AUTO-JOIN] Socket ${socket.id} forced into room: ${data.id}`);

        // Broadcast this to the admin dashboard
        io.emit('admin-receive-note', data);
    });

    // STUDENT MARKS SAFE OR DANGER
    socket.on('student-status', async (data) => {
        // --- FIX: AUTO-JOIN HERE TOO ---
        if(data.id) socket.join(data.id);
        
        io.emit('admin-dashboard-update', data);
    });

    socket.on('register-student', (studentId) => {
        if(studentId) {
            socket.join(studentId);
            console.log(`[ROOM] Student ${studentId} manually joined room via register-student`);
        }
    });

    socket.on('admin-reply', (data) => {
        console.log(`[REPLY] Admin sending to ${data.targetId}: ${data.message}`);
        
        // Send to the specific room (Student ID)
        io.to(data.targetId).emit('receive-reply', {
            message: data.message
        });
    });
});

// Route to get all safe zones for the students
app.get('/api/safe-zones', async (req, res) => {
    const { data, error } = await supabase
        .from('safe_zones')
        .select('*');

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ SERVER READY! Access here: http://localhost:${PORT}`);
});