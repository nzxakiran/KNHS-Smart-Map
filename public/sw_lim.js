// sw.js - NDRRMC STYLE ALERT
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force update
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('push', event => {
    const data = event.data.json();
    console.log('Push Recieved:', data);

    // 1. "Drill" Vibration Pattern (Maximum allowed by Android Chrome)
    // 1 second RUMBLE, 0.2 second pause. Repeats for ~15 seconds.
    const aggressiveVibration = [
        1000, 200, 1000, 200, 1000, 200, 1000, 200, 1000, 200,
        1000, 200, 1000, 200, 1000, 200, 1000, 200, 1000, 200,
        1000, 200, 1000, 200
    ];

    event.waitUntil(
        self.registration.showNotification(data.title || "🚨 EMERGENCY ALERT", {
            body: data.body,
            
            // VISUALS
            icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', // Red Alert
            badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', // Status Bar
            image: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', // Large Image
            
            // BEHAVIOR (The NDRRMC Feel)
            vibrate: aggressiveVibration,
            sound: 'https://www.soundjay.com/mechanical/sounds/smoke-detector-1.mp3', // Try to play Siren
            tag: 'emergency-alert',
            renotify: true,           // Vibrate again even if one is already there
            requireInteraction: true, // Key: Won't disappear until user touches it
            priority: 'high',         // Wakes up screen on some Androids
            data: { url: '/' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    // When clicked, open the app immediately
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (const client of clientList) {
                if (client.url === '/' && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});