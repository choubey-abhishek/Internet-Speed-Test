const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(compression());
app.use(express.static(path.join(__dirname, '../public')));

// Configuration
const PORT = process.env.PORT || 3000;
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for download test
const UPLOAD_TEST_DURATION = 5000; // 5 seconds upload test
const PING_INTERVAL = 1000; // 1 second between pings

// Generate random test data
const generateTestData = (size) => {
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        data[i] = Math.floor(Math.random() * 256);
    }
    return data;
};

// Pre-generate test chunks for faster response
const TEST_CHUNKS = {
    '1mb': generateTestData(1024 * 1024),
    '5mb': generateTestData(5 * 1024 * 1024),
    '10mb': generateTestData(10 * 1024 * 1024),
    '25mb': generateTestData(25 * 1024 * 1024),
    '50mb': generateTestData(50 * 1024 * 1024),
    '100mb': generateTestData(100 * 1024 * 1024)
};

// Get best server location based on client IP
const getServerLocation = (ip) => {
    const locations = [
        { name: 'New York', lat: 40.7128, lon: -74.0060, region: 'US East' },
        { name: 'London', lat: 51.5074, lon: -0.1278, region: 'EU West' },
        { name: 'Tokyo', lat: 35.6762, lon: 139.6503, region: 'Asia East' },
        { name: 'Sydney', lat: -33.8688, lon: 151.2093, region: 'Oceania' },
        { name: 'Frankfurt', lat: 50.1109, lon: 8.6821, region: 'EU Central' },
        { name: 'Singapore', lat: 1.3521, lon: 103.8198, region: 'Asia Southeast' },
        { name: 'São Paulo', lat: -23.5505, lon: -46.6333, region: 'South America' },
        { name: 'Mumbai', lat: 19.0760, lon: 72.8777, region: 'Asia South' }
    ];
    
    // Simulate location detection (in production, use geoip-lite)
    const hash = ip.split('.').reduce((acc, octet) => acc + parseInt(octet), 0);
    return locations[hash % locations.length];
};

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || req.connection.remoteAddress;
    const serverLocation = getServerLocation(clientIp);
    
    console.log(`Client connected from ${clientIp} - Serving from ${serverLocation.name}`);
    
    // Send server info to client
    ws.send(JSON.stringify({
        type: 'server-info',
        server: serverLocation,
        timestamp: Date.now()
    }));

    let uploadData = [];
    let uploadStartTime = null;
    let totalUploadBytes = 0;

    ws.on('message', async (message) => {
        try {
            // Check if message is a string (control message) or buffer (upload data)
            if (typeof message === 'string') {
                const data = JSON.parse(message);
                
                switch (data.type) {
                    case 'start-download':
                        await handleDownloadTest(ws, data);
                        break;
                        
                    case 'start-upload':
                        uploadStartTime = Date.now();
                        totalUploadBytes = 0;
                        uploadData = [];
                        ws.send(JSON.stringify({
                            type: 'upload-ready',
                            message: 'Ready to receive upload data'
                        }));
                        break;
                        
                    case 'ping':
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: data.timestamp
                        }));
                        break;
                        
                    case 'latency-test':
                        // Measure precise latency
                        const latency = Date.now() - data.timestamp;
                        ws.send(JSON.stringify({
                            type: 'latency-result',
                            latency: latency,
                            jitter: calculateJitter(latency)
                        }));
                        break;
                }
            } else {
                // Handle binary upload data
                if (uploadStartTime) {
                    totalUploadBytes += message.length;
                    uploadData.push(message);
                    
                    // Calculate current upload speed
                    const elapsed = Date.now() - uploadStartTime;
                    if (elapsed >= 1000) { // Send update every second
                        const speedMbps = (totalUploadBytes * 8) / (elapsed / 1000) / 1000000;
                        ws.send(JSON.stringify({
                            type: 'upload-progress',
                            speed: speedMbps,
                            bytesTransferred: totalUploadBytes,
                            elapsed: elapsed
                        }));
                    }
                    
                    // Check if upload test should end
                    if (elapsed >= UPLOAD_TEST_DURATION) {
                        const finalSpeedMbps = (totalUploadBytes * 8) / (UPLOAD_TEST_DURATION / 1000) / 1000000;
                        
                        ws.send(JSON.stringify({
                            type: 'upload-complete',
                            speed: finalSpeedMbps,
                            totalBytes: totalUploadBytes,
                            duration: elapsed
                        }));
                        
                        uploadStartTime = null;
                        uploadData = [];
                    }
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Test failed. Please try again.'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Handle download test
async function handleDownloadTest(ws, data) {
    const { size = '10mb', chunkCount = 10 } = data;
    const chunk = TEST_CHUNKS[size] || TEST_CHUNKS['10mb'];
    const startTime = Date.now();
    let bytesSent = 0;
    
    for (let i = 0; i < chunkCount; i++) {
        if (ws.readyState !== WebSocket.OPEN) break;
        
        ws.send(chunk);
        bytesSent += chunk.length;
        
        // Send progress update every 2 chunks
        if (i % 2 === 0) {
            const elapsed = Date.now() - startTime;
            const speedMbps = (bytesSent * 8) / (elapsed / 1000) / 1000000;
            
            ws.send(JSON.stringify({
                type: 'download-progress',
                speed: speedMbps,
                bytesDownloaded: bytesSent,
                progress: ((i + 1) / chunkCount) * 100,
                elapsed: elapsed
            }));
        }
        
        // Small delay to prevent overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Send completion message
    const totalElapsed = Date.now() - startTime;
    const finalSpeedMbps = (bytesSent * 8) / (totalElapsed / 1000) / 1000000;
    
    ws.send(JSON.stringify({
        type: 'download-complete',
        speed: finalSpeedMbps,
        totalBytes: bytesSent,
        duration: totalElapsed
    }));
}

// Jitter calculation
let lastLatency = 0;
function calculateJitter(currentLatency) {
    if (lastLatency === 0) {
        lastLatency = currentLatency;
        return 0;
    }
    
    const jitter = Math.abs(currentLatency - lastLatency);
    lastLatency = currentLatency;
    return jitter;
}

// HTTP Routes for fallback and info
app.get('/api/servers', (req, res) => {
    const servers = [
        { id: 1, name: 'New York', sponsor: 'SpeedTest Pro', distance: 0 },
        { id: 2, name: 'London', sponsor: 'SpeedTest Pro', distance: 5567 },
        { id: 3, name: 'Tokyo', sponsor: 'SpeedTest Pro', distance: 10840 },
        { id: 4, name: 'Sydney', sponsor: 'SpeedTest Pro', distance: 15990 },
        { id: 5, name: 'Frankfurt', sponsor: 'SpeedTest Pro', distance: 6200 }
    ];
    
    res.json(servers);
});

app.get('/api/config', (req, res) => {
    res.json({
        version: '1.0.0',
        maxDownloadSize: 100 * 1024 * 1024, // 100MB
        maxUploadSize: 50 * 1024 * 1024, // 50MB
        testDuration: 10, // seconds
        features: ['multi-server', 'jitter-test', 'packet-loss-test']
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        connections: wss.clients.size,
        uptime: process.uptime()
    });
});

// Serve the main app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Professional Speed Test Server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`🌐 HTTP endpoint: http://localhost:${PORT}`);
    console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
});
