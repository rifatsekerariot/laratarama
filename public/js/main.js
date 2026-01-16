// Map Initialization
const map = L.map('map').setView([41.0082, 28.9784], 13); // Default Istanbul

// Dynamic App Config
fetch('/api/app-info').then(r => r.json()).then(data => {
    if (data.name) {
        document.title = data.name + ' - Dashboard';
        const brand = document.getElementById('app-brand');
        if (brand) brand.innerText = data.name;
    }
});

// Dark Matter Tiles (CartoDB)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// Layers
const pointsLayer = L.layerGroup().addTo(map);
const userLocationMarker = L.circleMarker([0, 0], {
    radius: 8,
    fillColor: '#3b82f6',
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.8
});

// State
let pollingInterval = null;
let currentSessionId = null;

// Icons logic (Colors)
function getColor(rssi) {
    if (rssi > -100) return '#22c55e'; // Green
    if (rssi > -115) return '#f97316'; // Orange
    return '#ef4444'; // Red
}

// Fetch and Draw Points
async function loadData() {
    try {
        const response = await fetch('/api/get-all-data');
        const data = await response.json();

        pointsLayer.clearLayers();

        data.forEach(point => {
            const isSaved = point.type === 'saved';
            // Only 'saved' points can be deleted
            const deleteBtn = isSaved ? `<button class="popup-btn-delete" onclick="window.deletePoint(${point.id})">Sil</button>` : '';

            L.circleMarker([point.latitude, point.longitude], {
                radius: 8,
                fillColor: getColor(point.rssi),
                color: '#fff', // Border
                weight: 1,
                opacity: 1,
                fillOpacity: 0.7
            })
                .bindPopup(`
                <div class="custom-popup">
                    <div class="popup-header">
                        <span class="popup-tag ${point.type}">${point.type.toUpperCase()}</span>
                        <span class="popup-time">${new Date(point.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div class="popup-stats">
                        <div class="stat-item">
                            <span class="stat-label">RSSI</span>
                            <span class="stat-value" style="color:${getColor(point.rssi)}">${point.rssi} dBm</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">SNR</span>
                            <span class="stat-value">${point.snr} dB</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">SF</span>
                            <span class="stat-value">${point.spreading_factor || '-'}</span>
                        </div>
                         <div class="stat-item">
                            <span class="stat-label">BW</span>
                            <span class="stat-value">${point.bandwidth ? (point.bandwidth / 1000) + 'k' : '-'}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">CR</span>
                            <span class="stat-value">${point.code_rate || '-'}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">FREQ</span>
                            <span class="stat-value">${point.frequency ? (point.frequency / 1000000).toFixed(1) : '-'}</span>
                        </div>
                         <div class="stat-item">
                            <span class="stat-label">GW</span>
                            <span class="stat-value" title="${point.gateway_id}">${point.gateway_id ? point.gateway_id.substring(0, 6) + '...' : '-'}</span>
                        </div>
                         <div class="stat-item">
                            <span class="stat-label">CRC</span>
                            <span class="stat-value">${point.crc_status === 'CRC_OK' ? 'OK' : (point.crc_status || '-')}</span>
                        </div>
                         <div class="stat-item">
                            <span class="stat-label">CH / ADR</span>
                            <span class="stat-value">${point.channel || '-'}/${point.adr ? 'ON' : 'OFF'}</span>
                        </div>
                    </div>
                    ${deleteBtn}
                </div>
            `)
                .addTo(pointsLayer);
        });
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Global Delete Function used in Popups
window.deletePoint = async (id) => {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    try {
        const res = await fetch(`/api/points/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadData(); // Refresh map
        } else {
            alert('Silinemedi.');
        }
    } catch (e) {
        console.error(e);
        alert('Hata oluştu.');
    }
};

// User Location
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        userLocationMarker.setLatLng([lat, lng]);
        if (!map.hasLayer(userLocationMarker)) {
            userLocationMarker.addTo(map);
            map.setView([lat, lng], 15);
        }
    }, (err) => {
        console.warn('Geolocation denied or error');
    }, {
        enableHighAccuracy: true
    });
}

// UI Elements
const statusBox = document.getElementById('status-box');
const statusText = document.getElementById('status-text');
const btnStart = document.getElementById('btn-start');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');

// Chart Initialization
const ctx = document.getElementById('signalChart').getContext('2d');
const signalChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'RSSI History',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.1,
            fill: true
        }]
    },
    options: {
        responsive: true,
        plugins: {
            legend: { labels: { color: 'white' } }
        },
        scales: {
            y: {
                beginAtZero: false,
                ticks: { color: '#94a3b8' },
                grid: { color: '#334155' }
            },
            x: {
                ticks: { display: false } // Hide timestamps for clean look
            }
        }
    }
});

// Controls
btnStart.addEventListener('click', startMeasurement);
btnClear.addEventListener('click', () => {
    loadData(); // Refresh
});

btnExport.addEventListener('click', () => {
    window.location.href = '/api/export-csv';
});

async function startMeasurement() {
    // 1. Start Session
    try {
        const res = await fetch('/api/start-session');
        if (res.status === 401 || res.redirected) window.location.href = '/login.html';

        const data = await res.json();

        if (data.status === 'started') {
            // Show UI
            statusBox.style.display = 'block';
            statusText.innerText = 'Measuring (0/3)';

            // Start Polling
            if (pollingInterval) clearInterval(pollingInterval);
            pollingInterval = setInterval(pollSession, 2000);
        }
    } catch (e) {
        alert('Failed to start session. Check auth?');
    }
}

async function pollSession() {
    try {
        const res = await fetch('/api/poll-session');
        const data = await res.json();

        if (data.status === 'pending') {
            statusText.innerText = `Measuring (${data.count}/3)`;
        } else if (data.status === 'complete') {
            clearInterval(pollingInterval);
            statusText.innerText = 'Complete!';

            // Auto-Save without prompt
            // Note is empty string by default
            savePoint(data.avg_rssi, data.avg_snr, data.sf, '');
        }
    } catch (e) {
        console.error(e);
    }
}

async function savePoint(rssi, snr, sf, note) {
    // Get current location from marker or navigator
    const lat = userLocationMarker.getLatLng().lat;
    const lng = userLocationMarker.getLatLng().lng;

    if (lat === 0 && lng === 0) {
        alert('No location fix yet!');
        statusBox.style.display = 'none';
        return;
    }

    try {
        const res = await fetch('/api/save-point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                avg_rssi: rssi,
                avg_snr: snr,
                sf: sf,
                lat: lat,
                lng: lng,
                note: note
            })
        });

        const result = await res.json();
        if (result.success) {
            // alert('Saved successfully!'); // Removed alert to be less intrusive
            statusBox.style.display = 'none';
            loadData(); // Refresh map immediately
        }
    } catch (e) {
        alert('Error saving');
        statusBox.style.display = 'none';
    }
}

// Initial Load
loadData();
