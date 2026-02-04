const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push'); 
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- 1. CONFIGURATION ---
const SUPABASE_URL = 'https://dmomqmfqvfjvxswpgwge.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtb21xbWZxdmZqdnhzd3Bnd2dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NTk1MjksImV4cCI6MjA4NTEzNTUyOX0.Ij3zwZX7Zqn_IMeSKVoeJbE9gl06qmbvoFXtiLWUv3E';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 2. VAPID KEYS (HARDCODED) ---
const publicVapidKey = 'BO2TCO8NgiwHgW9vd2eDfMv3xu5n68NHwseA2YntRGQH_KlUWp-47npfemKC7gNjcTUD_m7tazM19Gh9yAO-UUg';
const privateVapidKey = 'XmYMsQ79u1ne_xu0PIKmk_d5FnqVHcleo6Q8vmeh2zE';

webpush.setVapidDetails(
  'mailto:admin@knhs.edu.ph',
  publicVapidKey,
  privateVapidKey
);

// --- 3. MIDDLEWARE ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 
app.use(bodyParser.json());
app.use(session({
    secret: 'knhs_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));
app.use(express.static(path.join(__dirname, 'www')));

app.use(express.static(path.join(__dirname, 'public')));

// --- 4. ROUTES ---

// Home Page Logic
app.get('/', (req, res) => {
    if (req.session.role === 'admin') return res.redirect('/admin');
    if (req.session.role === 'student') return res.redirect('/student');
    res.sendFile(path.join(__dirname, 'public', 'login.html')); 
});

// PUSH NOTIFICATION: Get Public Key
app.get('/api/vapid-key', (req, res) => {
    res.json({ publicKey: publicVapidKey });
});

// PUSH NOTIFICATION: Subscribe User
app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    // In a real app, save this to Supabase to keep it forever. 
    // For this demo, we use memory (RAM).
    if (!global.subscriptions) global.subscriptions = [];
    
    // Avoid duplicates
    const exists = global.subscriptions.find(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
        global.subscriptions.push(subscription);
        console.log("✅ New Device Subscribed! Total:", global.subscriptions.length);
    }
    res.status(201).json({});
});

// LOGIN AUTHENTICATION
app.post('/auth/login', async (req, res) => {
    const username = req.body.username ? req.body.username.trim() : '';
    const password = req.body.password ? req.body.password.trim() : '';
    
    // A. ADMIN LOGIN
    if (username.toLowerCase() === 'admin' && password === 'knhs2026') {
        req.session.loggedin = true;
        req.session.role = 'admin';
        return res.redirect('/admin');
    }
    
    // B. STUDENT LOGIN
    const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('student_id', username)
        .single(); // Removed .eq('password', password) if students only use ID

    if (student) {
        req.session.loggedin = true;
        req.session.role = 'student';
        req.session.username = student.name;
        req.session.studentId = student.student_id;
        
        // Crucial: Manually save the session before redirecting to ensure Render registers it
        return req.session.save(() => {
            res.redirect('/student');
        });
    }
});

// REGISTER NEW STUDENT
app.post('/auth/register', async (req, res) => {
    const newId = req.body.username ? req.body.username.trim() : '';
    const newPassword = req.body.password ? req.body.password.trim() : '';
    const newName = req.body.fullname ? req.body.fullname.trim() : 'New Student';

    if (!newId || !newPassword) return res.redirect('/register.html?error=missing_fields');

    const { error } = await supabase
        .from('students')
        .insert([{ student_id: newId, password: newPassword, name: newName }]);

    if (error) {
        return res.redirect('/register.html?error=user_already_exists');
    }

    res.redirect('/?success=registered');
});

app.get('/api/me', (req, res) => {
    if (req.session.loggedin && req.session.role === 'student') {
        // Ensure these keys match exactly what you set in app.post('/auth/login')
        res.json({ 
            id: req.session.studentId, 
            name: req.session.username 
        });
    } else {
        res.status(401).json({ error: "Not logged in" });
    }
});

app.post('/api/sync', async (req, res) => {
    const { id, logs } = req.body;
    
    if (!id || !logs || logs.length === 0) {
        return res.status(400).json({ status: 'no_data' });
    }

    console.log(`[SYNC] Receiving ${logs.length} offline logs from ${id}`);

    // 1. Process individual updates (so map updates immediately)
    for (const log of logs) {
        if (log.type === 'NOTE') {
            io.emit('admin-receive-note', { id: id, message: `[OFFLINE]: ${log.content}` });
        } else if (log.type === 'STATUS') {
            io.emit('admin-dashboard-update', { id: id, status: log.content, lat: log.lat, lng: log.lng });
        }
    }
    io.emit('admin-sync-report', {
        id: id,
        logs: logs,
        lastSeen: new Date().toISOString(),
        count: logs.length
    });

    res.json({ status: 'success', count: logs.length });
});

// PROTECTED PAGES
app.get('/admin', (req, res) => {
    if (req.session.role === 'admin') res.sendFile(path.join(__dirname, 'public','admin.html'));
    else res.redirect('/');
});

app.get('/student', (req, res) => {
    if (req.session.loggedin && req.session.role === 'student') {
        res.sendFile(path.join(__dirname, 'public', 'student.html')); // Make sure this is student.html, not index.html
    } else {
        console.log("Session Check Failed. Redirecting to login...");
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. SOCKET.IO & PUSH LOGIC ---
const activeSockets = new Map();

io.on('connection', async (socket) => {
    
    console.log(`[SOCKET] User connected: ${socket.id}`);

    const { data: logs } = await supabase.from('disaster_logs').select('*').order('created_at', { ascending: false });
    socket.emit('log-history', logs || []);

    // --- ALERT SYSTEM ---
    socket.on('broadcast-alert', async (data) => {
        console.log("📢 ALERT TRIGGERED:", data.type);
        
        // 1. Save Log
        const { data: newLog, error } = await supabase.from('disaster_logs').insert([{ type: data.type }]).select().single();
        if (!error) {
            io.emit('update-logs', { type: newLog.type, time: new Date(newLog.created_at).toLocaleTimeString() });
        }

        // 2. Socket Alert (Online Users)
        io.emit('receive-alert', data);

        // 3. Web Push (Offline/Background Users)
        const payload = JSON.stringify({ 
            title: `⚠️ ${data.type} ALERT!`, 
            body: data.message 
        });
        
        if (global.subscriptions) {
            console.log(`Sending Push to ${global.subscriptions.length} devices...`);
            global.subscriptions.forEach(sub => {
                webpush.sendNotification(sub, payload).catch(err => {
                    if (err.statusCode === 410) {
                        console.log("Subscription expired, removing...");
                        // Ideally remove from array here
                    } else {
                        console.error("Push Error:", err);
                    }
                });
            });
        }
    });

    socket.on('register-student', (studentId) => {
        if(studentId) {
            socket.join(studentId);
            activeSockets.set(socket.id, studentId);
            console.log(`[ONLINE] Student ${studentId}`);
        }
    });

    // NEW FEATURE: Handle real-time student updates (Location/Status)
    socket.on('student-update', async (data) => {
        // Broadcast to admin dashboard
        io.emit('admin-dashboard-update', data);
        
        // Update database timestamp (last seen)
        try {
            await supabase.rpc('update_last_seen', { student_id_param: data.id });
        } catch (err) {
            console.error("DB Update Error:", err);
        }
    });

    socket.on('student-note', (data) => { 
        socket.join(data.id); 
        io.emit('admin-receive-note', data); 
    });

    socket.on('student-status', (data) => { 
        if(data.id) socket.join(data.id); 
        io.emit('admin-dashboard-update', data); 
    });

    socket.on('admin-reply', (data) => { 
        io.to(data.targetId).emit('receive-reply', { message: data.message }); 
    });

    socket.on('disconnect', () => {
        if (activeSockets.has(socket.id)) {
            const studentId = activeSockets.get(socket.id);
            io.emit('student-disconnected', { id: studentId });
            console.log(`[OFFLINE] Student ${studentId}`);
            activeSockets.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅ SERVER READY! Access here: http://localhost:${PORT}`);
});``