/**
 * YolSinyali - Core client-side script for Traffic Reporting and Location Sharing
 * Works inside Android assets (WebView) or any web browser
 */

// Developer Configuration
let SERVER_URL = ""; // Pre-filled dynamically on login. Fallback to local address if empty.
let socket = null;
let map = null;

// User Session Information
let username = "Sürücü";
let currentCoords = { lat: 41.0082, lng: 28.9784 }; // Defaults to Istanbul Center
let selfMarker = null;

// Leaflet Layer Registers
const activeMarkersMap = {}; // Key: report_id, Value: Leaflet Marker Layer instance

// CSS colors and icon bindings corresponding to type
const REPORT_THEMES = {
    "Trafik Çevirmesi": {
        icon: "fa-shield-halved",
        color: "#3B82F6", // Blue
        bgColor: "bg-blue-500",
        iconColor: "text-blue-500",
        shadowColor: "rgba(59, 130, 246, 0.5)"
    },
    "Kaza": {
        icon: "fa-car-burst",
        color: "#EF4444", // Red
        bgColor: "bg-red-500",
        iconColor: "text-red-500",
        shadowColor: "rgba(239, 68, 68, 0.5)"
    },
    "Yemek Yeri": {
        icon: "fa-utensils",
        color: "#10B981", // Green
        bgColor: "bg-green-500",
        iconColor: "text-green-500",
        shadowColor: "rgba(16, 185, 129, 0.5)"
    }
};

// Selected options in report generator
let selectedReportType = null;
let placementLatLng = null;

// 1. CHRONOLOGY BOOTSTRAPPER
window.addEventListener("DOMContentLoaded", () => {
    // Restore session cache if existing
    const cachedUsername = localStorage.getItem("yolsinyali_username");
    const cachedServer = localStorage.getItem("yolsinyali_server_url");

    if (cachedUsername) {
        document.getElementById("input-username").value = cachedUsername;
    }
    if (cachedServer) {
        document.getElementById("input-server").value = cachedServer;
    } else {
        // Render server default fallback example
        document.getElementById("input-server").value = "https://yolsinyali-backend.onrender.com";
    }

    // Assign UI interaction controllers
    document.getElementById("btn-login").addEventListener("click", performLoginAndConnect);
    document.getElementById("btn-recenter").addEventListener("click", centerMapOnUser);
    document.getElementById("btn-toggle-report").addEventListener("click", () => openReportModal(null));
    document.getElementById("btn-close-modal").addEventListener("click", closeReportModal);
    document.getElementById("btn-submit-report").addEventListener("click", submitReportToServer);

    // Coordinate sharing triggers
    document.getElementById("btn-share-coord-whatsapp").addEventListener("click", () => shareSelfLocation("whatsapp"));
    document.getElementById("btn-share-coord-sms").addEventListener("click", () => shareSelfLocation("sms"));

    // Select category buttons mapping
    const typeButtons = document.querySelectorAll(".btn-select-type");
    typeButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            // Remove active classes
            typeButtons.forEach(b => {
                b.classList.remove("border-brand-accent", "bg-brand-accent/15", "scale-[0.98]");
                b.classList.add("border-white/10", "bg-brand-dark");
            });

            // Select clicked
            const selectedBtn = e.currentTarget;
            selectedBtn.classList.remove("border-white/10", "bg-brand-dark");
            selectedBtn.classList.add("border-brand-accent", "bg-brand-accent/15", "scale-[0.98]");
            
            selectedReportType = selectedBtn.getAttribute("data-type");

            // Toggle duration choice
            const durationContainer = document.getElementById("duration-selection-container");
            if (selectedReportType === "Yemek Yeri") {
                durationContainer.classList.add("hidden");
            } else {
                durationContainer.classList.remove("hidden");
            }
        });
    });

    // Initialize map immediately in blurred background
    initLeafletMapInstance();
    // Launch GPS tracking hook pre-login
    initGeolocationMonitoring();
});

// 2. LEAFLET MAP INCEPTION
function initLeafletMapInstance() {
    // Initial centering point: Istanbul Center coordinates
    map = L.map("map", {
        zoomControl: false, // Default is hidden, we'll place custom scale inside or rely on web controls
        attributionControl: false
    }).setView([currentCoords.lat, currentCoords.lng], 13);

    // CartoDB Dark Matter style, high contrast, elegant night mode
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 20
    }).addTo(map);

    // Listen for clicking coordinates on map to pin point directly
    map.on("click", (e) => {
        // Clicking directly opens reporting modal pointing to tap coordinates
        openReportModal(e.latlng);
    });
}

// 3. DEVICE GEOLOCATION ADAPTER (NAVIGATOR.GEOLOCATION)
function initGeolocationMonitoring() {
    if (!navigator.geolocation) {
        console.warn("Geolocation API is not supported by this container.");
        document.getElementById("coords-text").innerText = "GPS API Desteklenmiyor.";
        return;
    }

    const geoOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000
    };

    // Watch position in real time
    navigator.geolocation.watchPosition(
        (position) => {
            currentCoords.lat = position.coords.latitude;
            currentCoords.lng = position.coords.longitude;

            // Render coordinates in bottom UI bar
            document.getElementById("coords-text").innerText = 
                `${currentCoords.lat.toFixed(6)} N, ${currentCoords.lng.toFixed(6)} E`;

            updateSelfMarkerOnMap();
        },
        (error) => {
            console.error("GPS tracking error: ", error);
            // Fallback indicator text
            document.getElementById("coords-text").innerText = "Konum alınamadı (GPS kapalı veya yetki yok)";
        },
        geoOptions
    );
}

// Draw/update self pulsing location marker on map
function updateSelfMarkerOnMap() {
    if (!map) return;

    const selfIconHtml = `
        <div class="relative flex items-center justify-center w-8 h-8">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-60"></span>
            <div class="relative rounded-full h-4 w-4 bg-blue-600 border-2 border-white shadow-md"></div>
        </div>
    `;

    const customSelfHtmlIcon = L.divIcon({
        html: selfIconHtml,
        className: "custom-self-marker",
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    if (selfMarker) {
        selfMarker.setLatLng([currentCoords.lat, currentCoords.lng]);
    } else {
        selfMarker = L.marker([currentCoords.lat, currentCoords.lng], {
            icon: customSelfHtmlIcon,
            zIndexOffset: 1000 // Ensure user marker is always on top
        }).addTo(map);
        
        // On load, pan map to user location
        centerMapOnUser();
    }
}

function centerMapOnUser() {
    if (map && currentCoords) {
        map.setView([currentCoords.lat, currentCoords.lng], 15, { animate: true });
    }
}

// 4. USER CONCURRENT CONNECTIVITY GATEWAY
function performLoginAndConnect() {
    const inputUser = document.getElementById("input-username").value.trim();
    let inputServer = document.getElementById("input-server").value.trim();

    if (!inputUser) {
        alert("Lütfen geçerli bir kullanıcı adı girin!");
        return;
    }

    username = inputUser;
    SERVER_URL = inputServer;

    // Cache to localStorage
    localStorage.setItem("yolsinyali_username", username);
    localStorage.setItem("yolsinyali_server_url", SERVER_URL);

    // Update username display block
    document.getElementById("user-display").innerText = `@${username}`;

    // Establish Socket.io handshake
    connectWebSocketServer();

    // Smoothly remove login overlay UI
    const overlay = document.getElementById("login-overlay");
    overlay.classList.add("opacity-0", "pointer-events-none");
    setTimeout(() => {
        overlay.classList.add("hidden");
    }, 500);
}

// Assemble Socket communication channels
function connectWebSocketServer() {
    console.log(`Connecting to Socket server: ${SERVER_URL || "Local Fallback"}`);

    // If SERVER_URL is blank or not defined, instantiate without parameter to point back to current host source port (e.g. Render server running standard origin proxy)
    const options = {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000
    };

    if (SERVER_URL) {
        socket = io(SERVER_URL, options);
    } else {
        // Localhost fallback
        socket = io(options);
    }

    // Connections lifecycle callbacks
    socket.on("connect", () => {
        console.log("WebSocket connected successfully!");
        updateNetworkStatusIndicator(true);
    });

    socket.on("disconnect", () => {
        console.warn("WebSocket link severed.");
        updateNetworkStatusIndicator(false);
    });

    socket.on("connect_error", (err) => {
        console.error("Connect error:", err);
        updateNetworkStatusIndicator(false);
    });

    // Receives catalog of active markers on first handshake
    socket.on("init_reports", (reportsList) => {
        console.log(`Received initial active reports bundle: ${reportsList.length} items`);
        // Remove all previous markers
        Object.keys(activeMarkersMap).forEach(id => {
            map.removeLayer(activeMarkersMap[id]);
            delete activeMarkersMap[id];
        });

        // Add newly fetched active items
        reportsList.forEach(report => {
            renderMarkerOnMap(report);
        });
    });

    // Real-time addition of reports via WebSockets (No layout loading wait)
    socket.on("report_added", (report) => {
        console.log("New real-time marker received:", report);
        // Only render if it is not already plotted
        if (!activeMarkersMap[report.id]) {
            renderMarkerOnMap(report);
            triggerRealtimeToastAlert(report);
        }
    });

    // Real-time eviction of expired items (Dynamic TTL triggers)
    socket.on("report_expired", (data) => {
        console.log(`Live eviction triggered for report ID: ${data.id}`);
        removeMarkerFromMap(data.id);
    });
}

function updateNetworkStatusIndicator(connected) {
    const indicator = document.getElementById("connection-indicator");
    const indicatorPing = document.getElementById("connection-indicator-ping");
    
    if (connected) {
        indicator.className = "relative inline-flex rounded-full h-3 w-3 bg-brand-success";
        indicatorPing.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-success opacity-75";
    } else {
        indicator.className = "relative inline-flex rounded-full h-3 w-3 bg-brand-danger";
        indicatorPing.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-danger opacity-75";
    }
}

// 5. INCIDENT FORM MODAL HANDLER
function openReportModal(latlng) {
    // Check if user is logged in first
    const isLoginHidden = document.getElementById("login-overlay").classList.contains("hidden");
    if (!isLoginHidden) {
        alert("Lütfen önce haritaya bağlanın.");
        return;
    }

    if (latlng) {
        placementLatLng = latlng;
    } else {
        // Fallback to active GPS coordinates
        placementLatLng = L.latLng(currentCoords.lat, currentCoords.lng);
    }

    // Set coordinates text
    document.getElementById("modal-latlng-text").innerText = 
        `${placementLatLng.lat.toFixed(6)}, ${placementLatLng.lng.toFixed(6)}`;

    // Reset buttons layout selection
    selectedReportType = null;
    document.querySelectorAll(".btn-select-type").forEach(b => {
        b.classList.remove("border-brand-accent", "bg-brand-accent/15", "scale-[0.98]");
        b.classList.add("border-white/10", "bg-brand-dark");
    });
    
    document.getElementById("duration-selection-container").classList.add("hidden");

    // Reveal container
    const modal = document.getElementById("report-modal");
    modal.classList.remove("hidden");
}

function closeReportModal() {
    document.getElementById("report-modal").classList.add("hidden");
    placementLatLng = null;
    selectedReportType = null;
}

function submitReportToServer() {
    if (!selectedReportType) {
        alert("Lütfen bir ihbar kategorisi seçin!");
        return;
    }

    if (!placementLatLng) {
        alert("Gereken konum verisi eksik.");
        return;
    }

    let duration = 120; // Default: 2 hours
    if (selectedReportType !== "Yemek Yeri") {
        duration = parseInt(document.getElementById("select-duration").value);
    } else {
        duration = -1; // Infinite/Permanent for food spots
    }

    const payload = {
        username: username,
        latitude: placementLatLng.lat,
        longitude: placementLatLng.lng,
        report_type: selectedReportType,
        duration_minutes: duration
    };

    if (socket && socket.connected) {
        // Transmit via high speed websocket connection
        socket.emit("new_report", payload);
        console.log("Sent report package to socket server:", payload);
        closeReportModal();
    } else {
        alert("Sunucu bağlantısı aktif değil. İhbar gönderilemez!");
    }
}

// 6. RENDER INDIVIDUAL INCIDENT MARKER ON LEAFLET
function renderMarkerOnMap(report) {
    if (!map) return;

    const theme = REPORT_THEMES[report.report_type] || REPORT_THEMES["Trafik Çevirmesi"];
    
    // Create highly responsive modern HTML marker instead of ugly default leaflet icon
    const htmlMarkerTemplate = `
        <div class="relative flex items-center justify-center w-10 h-10 select-none">
            <div class="absolute w-8 h-8 rounded-full ${theme.bgColor} opacity-25 animate-pulse"></div>
            <div class="relative w-8 h-8 rounded-full ${theme.bgColor} border-2 border-white flex items-center justify-center shadow-lg" style="box-shadow: 0 0 10px ${theme.shadowColor};">
                <i class="fa-solid ${theme.icon} text-white text-xs"></i>
            </div>
        </div>
    `;

    const customIcon = L.divIcon({
        html: htmlMarkerTemplate,
        className: `custom-incident-marker-${report.id}`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -18]
    });

    // Populate remaining duration text
    let durationString = "";
    if (report.duration_minutes === -1) {
        durationString = "Süresiz (Kalıcı)";
    } else {
        // Calculate remaining mins
        const createdDate = new Date(report.created_at);
        const expiryDate = new Date(createdDate.getTime() + report.duration_minutes * 60000);
        const remainingMs = expiryDate - new Date();
        const remainingMins = Math.max(0, Math.floor(remainingMs / 60000));
        
        if (remainingMins > 60) {
            durationString = `${Math.floor(remainingMins / 60)} sa. ${remainingMins % 60} dk. kaldı`;
        } else {
            durationString = `${remainingMins} dakika kaldı`;
        }
    }

    const createdTimeStr = new Date(report.created_at).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});

    // 7. INCIDENT PIN CLICK POPUP WITH INTEGRATED EXTERNAL WHATSAPP & SMS DEEP-LINKING
    const popupContentHtml = `
        <div class="w-64 p-3 rounded-2xl bg-brand-dark font-sans text-white border border-white/5 flex flex-col space-y-4 shadow-xl select-none">
            <div class="flex justify-between items-start gap-2">
                <div>
                     <span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${theme.bgColor}/20 ${theme.iconColor} border border-${theme.color}/20">
                        ${report.report_type}
                     </span>
                     <h4 class="text-sm font-bold mt-1 text-slate-100">${report.report_type} Bildirimi</h4>
                </div>
                <span class="text-[10px] text-slate-400 font-medium">${createdTimeStr}</span>
            </div>
            
            <div class="text-xs space-y-1 bg-brand-darker/60 p-2.5 rounded-xl border border-white/5">
                <p class="text-slate-400"><i class="fa-solid fa-user mr-1 text-slate-500"></i> Ekleyen: <strong class="text-slate-200">@${report.username}</strong></p>
                <p class="text-slate-400"><i class="fa-solid fa-clock mr-1 text-slate-500"></i> Süre: <span class="text-slate-300 font-medium">${durationString}</span></p>
                <p class="text-[10px] text-slate-500 mt-1 font-mono">${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}</p>
            </div>

            <div class="flex gap-2">
                <!-- Direct share buttons for this marker -->
                <button onclick="shareIncidentPoint(${report.latitude}, ${report.longitude}, '${report.report_type}', 'whatsapp')" 
                        class="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold text-[11px] flex items-center justify-center space-x-1.5 transition-colors">
                    <i class="fa-brands fa-whatsapp text-sm"></i>
                    <span>WhatsApp</span>
                </button>
                <button onclick="shareIncidentPoint(${report.latitude}, ${report.longitude}, '${report.report_type}', 'sms')" 
                        class="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center justify-center space-x-1.5 transition-colors">
                    <i class="fa-solid fa-comment-sms text-sm"></i>
                    <span>SMS ilet</span>
                </button>
            </div>
        </div>
    `;

    // Leaflet styles overrides for modern glass theme popup
    const popupOptions = {
        className: "custom-leaflet-popup",
        closeButton: false,
        maxWidth: 280,
        minWidth: 240
    };

    const marker = L.marker([report.latitude, report.longitude], { icon: customIcon });
    marker.bindPopup(popupContentHtml, popupOptions);
    marker.addTo(map);

    // Register in map tracker
    activeMarkersMap[report.id] = marker;
}

function removeMarkerFromMap(id) {
    if (activeMarkersMap[id]) {
        map.removeLayer(activeMarkersMap[id]);
        delete activeMarkersMap[id];
    }
}

// 8. REAL-TIME TOAST ACTION ALERT PANEL
function triggerRealtimeToastAlert(report) {
    const alertContainer = document.getElementById("alert-container");
    const toastId = `toast-${Date.now()}`;
    const theme = REPORT_THEMES[report.report_type] || REPORT_THEMES["Trafik Çevirmesi"];

    const toastHtml = `
        <div id="${toastId}" class="glass-panel p-3 rounded-2xl flex items-center space-x-3.5 shadow-xl border border-white/10 hover:bg-white/5 transition-all transform translate-x-20 opacity-0 pointer-events-auto cursor-pointer max-w-xs">
            <div class="p-2.5 rounded-xl ${theme.bgColor}/20 border border-${theme.color}/10 ${theme.iconColor} text-lg">
                <i class="fa-solid ${theme.icon}"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-xs font-bold text-white leading-normal truncate">Yeni İhbar: ${report.report_type}</p>
                <p class="text-[10px] text-slate-400 mt-0.5 truncate">@${report.username} tarafından bildirildi.</p>
            </div>
            <button class="text-xs text-slate-500 hover:text-white px-1">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
    `;

    alertContainer.insertAdjacentHTML("beforeend", toastHtml);
    const toastEl = document.getElementById(toastId);

    // Slide in animation
    setTimeout(() => {
        toastEl.classList.remove("translate-x-20", "opacity-0");
    }, 100);

    // Fly-to coordinates if clicked
    toastEl.addEventListener("click", () => {
        if (map) {
            map.setView([report.latitude, report.longitude], 16, { animate: true });
            // Highlight / Open marker popup
            if (activeMarkersMap[report.id]) {
                activeMarkersMap[report.id].openPopup();
            }
        }
        dismissToast(toastEl);
    });

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
        dismissToast(toastEl);
    }, 6000);
}

function dismissToast(element) {
    if (element && element.parentNode) {
        element.classList.add("translate-x-20", "opacity-0");
        setTimeout(() => {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        }, 300);
    }
}

// 9. WHATSAPP & SMS INTENT LAUNCHERS
function shareSelfLocation(platform) {
    if (!currentCoords.lat || !currentCoords.lng) {
        alert("Gerçek konum verisi bulunamadı!");
        return;
    }

    const message = `YolSinyali: Anlık konumumu paylaşıyorum! Konum koordinatları: Enlem: ${currentCoords.lat.toFixed(6)}, Boylam: ${currentCoords.lng.toFixed(6)}. Google Haritalar'da görmek için tıklayın: https://maps.google.com/?q=${currentCoords.lat.toFixed(6)},${currentCoords.lng.toFixed(6)}`;
    executeShareIntent(message, platform);
}

function shareIncidentPoint(lat, lng, type, platform) {
    const message = `YolSinyali: Burada bir [${type}] var! Konum koordinatları: Enlem: ${lat.toFixed(6)}, Boylam: ${lng.toFixed(6)}. Google Haritalar'da görmek için tıklayın: https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    executeShareIntent(message, platform);
}

function executeShareIntent(text, platform) {
    const encodedText = encodeURIComponent(text);
    let targetUrl = "";

    if (platform === "whatsapp") {
        targetUrl = `https://wa.me/?text=${encodedText}`;
    } else if (platform === "sms") {
        // Correct cross-device SMS deep linking scheme
        targetUrl = `sms:?body=${encodedText}`;
    }

    if (targetUrl) {
        console.log(`Launching Share deep-link: ${targetUrl}`);
        window.open(targetUrl, "_blank");
    }
}
