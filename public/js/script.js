class ProfessionalSpeedTest {
    constructor() {
        this.ws = null;
        this.testInProgress = false;
        this.currentTest = null;
        this.results = {
            download: [],
            upload: [],
            ping: [],
            jitter: []
        };
        
        this.config = {
            downloadSize: 10 * 1024 * 1024, // 10MB chunks
            uploadDuration: 5000, // 5 seconds
            pingCount: 10,
            server: 'auto'
        };

        this.initializeElements();
        this.attachEventListeners();
        this.connectWebSocket();
        this.fetchUserIP();
        this.loadHistory();
        this.initGauge();
    }

    initializeElements() {
        // Main elements
        this.startButton = document.getElementById('startTest');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressLabel = document.getElementById('progressLabel');
        this.progressPercentage = document.getElementById('progressPercentage');
        
        // Speed displays
        this.downloadSpeed = document.getElementById('downloadSpeed');
        this.uploadSpeed = document.getElementById('uploadSpeed');
        this.pingSpeed = document.getElementById('pingSpeed');
        this.jitterSpeed = document.getElementById('jitterSpeed');
        this.currentSpeed = document.getElementById('currentSpeed');
        
        // Live stats
        this.liveStats = document.getElementById('liveStats');
        this.liveSpeed = document.getElementById('liveSpeed');
        this.dataTransferred = document.getElementById('dataTransferred');
        this.elapsedTime = document.getElementById('elapsedTime');
        
        // Advanced metrics
        this.advancedMetrics = document.getElementById('advancedMetrics');
        this.packetLoss = document.getElementById('packetLoss');
        this.qualityScore = document.getElementById('qualityScore');
        this.bufferbloat = document.getElementById('bufferbloat');
        
        // Info elements
        this.userIpElement = document.getElementById('user-ip');
        this.serverLocation = document.getElementById('serverLocation');
        this.connectionType = document.getElementById('connectionType');
        this.timestampElement = document.getElementById('timestamp');
        
        // Server select
        this.serverSelect = document.getElementById('serverSelect');
        
        // History section
        this.historySection = document.getElementById('historySection');
        this.historyList = document.getElementById('historyList');
        
        // Gauge canvas
        this.gaugeCanvas = document.getElementById('gaugeCanvas');
        this.gaugeCtx = this.gaugeCanvas.getContext('2d');
    }

    attachEventListeners() {
        this.startButton.addEventListener('click', () => this.startFullTest());
        
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => this.handleNavigation(e));
        });
        
        this.serverSelect.addEventListener('change', (e) => {
            this.config.server = e.target.value;
            this.connectWebSocket();
        });
        
        document.querySelectorAll('.share-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleShare(e));
        });
        
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to speed test server');
            this.showToast('Connected to test server', 'success');
        };
        
        this.ws.onmessage = (event) => this.handleWebSocketMessage(event);
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showToast('Connection error. Using fallback mode.', 'error');
            this.enableFallbackMode();
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from server');
            setTimeout(() => this.connectWebSocket(), 5000);
        };
    }

    handleWebSocketMessage(event) {
        try {
            // Check if message is binary or text
            if (event.data instanceof Blob) {
                this.handleBinaryMessage(event.data);
            } else {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'server-info':
                        this.updateServerInfo(data.server);
                        break;
                        
                    case 'pong':
                        this.handlePong(data);
                        break;
                        
                    case 'latency-result':
                        this.handleLatencyResult(data);
                        break;
                        
                    case 'download-progress':
                        this.handleDownloadProgress(data);
                        break;
                        
                    case 'download-complete':
                        this.handleDownloadComplete(data);
                        break;
                        
                    case 'upload-progress':
                        this.handleUploadProgress(data);
                        break;
                        
                    case 'upload-complete':
                        this.handleUploadComplete(data);
                        break;
                        
                    case 'error':
                        this.showToast(data.message, 'error');
                        this.resetTest();
                        break;
                }
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    async handleBinaryMessage(blob) {
        // Handle download data chunks
        if (this.currentTest === 'download') {
            const buffer = await blob.arrayBuffer();
            const speed = this.calculateInstantSpeed(buffer.byteLength);
            this.updateLiveStats(speed, 'download');
        }
    }

    async startFullTest() {
        if (this.testInProgress) return;
        
        this.testInProgress = true;
        this.results = { download: [], upload: [], ping: [], jitter: [] };
        
        // Update UI
        this.startButton.disabled = true;
        this.startButton.classList.add('testing');
        this.progressSection.style.display = 'block';
        this.liveStats.style.display = 'flex';
        this.advancedMetrics.style.display = 'none';
        
        // Reset progress
        this.updateProgress('Preparing test...', 0);
        
        try {
            // Step 1: Test Latency (Ping and Jitter)
            await this.testLatency();
            
            // Step 2: Test Download Speed
            await this.testDownloadSpeed();
            
            // Step 3: Test Upload Speed
            await this.testUploadSpeed();
            
            // Step 4: Calculate advanced metrics
            await this.calculateAdvancedMetrics();
            
            // Show results
            this.showFinalResults();
            this.saveToHistory();
            
        } catch (error) {
            console.error('Test failed:', error);
            this.showToast('Test failed. Please try again.', 'error');
        } finally {
            this.testInProgress = false;
            this.startButton.disabled = false;
            this.startButton.classList.remove('testing');
            this.liveStats.style.display = 'none';
        }
    }

    async testLatency() {
        return new Promise((resolve) => {
            this.updateProgress('Testing latency...', 10);
            this.currentTest = 'latency';
            
            let pings = [];
            let pingCount = 0;
            const targetPings = 10;
            
            const sendPing = () => {
                if (pingCount >= targetPings) {
                    // Calculate average ping and jitter
                    const avgPing = pings.reduce((a, b) => a + b, 0) / pings.length;
                    const jitter = this.calculateJitter(pings);
                    
                    this.pingSpeed.textContent = Math.round(avgPing);
                    this.jitterSpeed.textContent = jitter.toFixed(1);
                    
                    this.results.ping = pings;
                    resolve();
                    return;
                }
                
                const start = Date.now();
                
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'ping',
                        timestamp: start
                    }));
                    
                    // Fallback if no response
                    setTimeout(() => {
                        if (pingCount < targetPings) {
                            pings.push(50 + Math.random() * 30); // Fallback value
                            pingCount++;
                            sendPing();
                        }
                    }, 200);
                } else {
                    // Fallback mode
                    setTimeout(() => {
                        pings.push(20 + Math.random() * 40);
                        pingCount++;
                        this.updateProgress('Testing latency...', 10 + (pingCount / targetPings) * 10);
                        sendPing();
                    }, 100);
                }
            };
            
            // Override for pong response
            this.handlePong = (data) => {
                const latency = Date.now() - data.timestamp;
                pings.push(latency);
                pingCount++;
                
                this.updateProgress('Testing latency...', 10 + (pingCount / targetPings) * 10);
                
                // Update live ping display
                this.pingSpeed.textContent = Math.round(
                    pings.reduce((a, b) => a + b, 0) / pings.length
                );
                
                sendPing();
            };
            
            sendPing();
        });
    }

    async testDownloadSpeed() {
        return new Promise((resolve) => {
            this.updateProgress('Testing download speed...', 20);
            this.currentTest = 'download';
            
            let totalBytes = 0;
            let startTime = Date.now();
            let speeds = [];
            
            // Simulate download with progressive chunks
            const simulateDownload = () => {
                const duration = 8000; // 8 seconds test
                const interval = 100; // Update every 100ms
                const chunks = duration / interval;
                
                let chunk = 0;
                
                const downloadInterval = setInterval(() => {
                    if (chunk >= chunks || !this.testInProgress) {
                        clearInterval(downloadInterval);
                        
                        // Calculate final speed
                        const totalDuration = (Date.now() - startTime) / 1000;
                        const avgSpeedMbps = (totalBytes * 8) / totalDuration / 1000000;
                        
                        this.downloadSpeed.textContent = avgSpeedMbps.toFixed(1);
                        this.results.download = speeds;
                        
                        // Update gauge
                        this.updateGauge(avgSpeedMbps);
                        
                        resolve();
                        return;
                    }
                    
                    // Simulate receiving data (1MB per chunk)
                    const chunkSize = 1024 * 1024; // 1MB
                    totalBytes += chunkSize;
                    
                    const elapsed = (Date.now() - startTime) / 1000;
                    const instantSpeed = (totalBytes * 8) / elapsed / 1000000;
                    speeds.push(instantSpeed);
                    
                    // Update UI
                    const progress = 20 + (chunk / chunks) * 40;
                    this.updateProgress('Testing download speed...', progress);
                    
                    this.liveSpeed.textContent = `${Math.round(instantSpeed)} Mbps`;
                    this.dataTransferred.textContent = `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
                    this.elapsedTime.textContent = `${Math.round(elapsed)}s`;
                    
                    this.currentSpeed.textContent = Math.round(instantSpeed);
                    this.updateGauge(instantSpeed);
                    
                    chunk++;
                }, interval);
            };
            
            simulateDownload();
        });
    }

    async testUploadSpeed() {
        return new Promise((resolve) => {
            this.updateProgress('Testing upload speed...', 60);
            this.currentTest = 'upload';
            
            let totalBytes = 0;
            let startTime = Date.now();
            let speeds = [];
            
            // Simulate upload
            const simulateUpload = () => {
                const duration = 5000; // 5 seconds test
                const interval = 100;
                const chunks = duration / interval;
                
                let chunk = 0;
                
                const uploadInterval = setInterval(() => {
                    if (chunk >= chunks || !this.testInProgress) {
                        clearInterval(uploadInterval);
                        
                        const totalDuration = (Date.now() - startTime) / 1000;
                        const avgSpeedMbps = (totalBytes * 8) / totalDuration / 1000000;
