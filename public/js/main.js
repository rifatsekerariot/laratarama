(function () {
    'use strict';

    const defaultCenter = [41.0082, 28.9784];
    const defaultZoom = 13;

    const map = L.map('map').setView(defaultCenter, defaultZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        subdomains: 'abc'
    }).addTo(map);

    const pointsLayer = L.layerGroup().addTo(map);
    let userLocationMarker = null;
    let currentLat = null;
    let currentLng = null;
    let modalShownAfterGps = false;

    function getAppInfo() {
        fetch('/api/app-info')
            .then(r => r.json())
            .then(data => {
                if (data.name) {
                    document.title = data.name;
                    const brand = document.getElementById('app-brand');
                    if (brand) brand.textContent = data.name;
                }
            })
            .catch(() => {});
    }
    getAppInfo();

    function setLocationStatus(text, isError) {
        const el = document.getElementById('location-status');
        const textEl = el && el.querySelector('.location-status-text');
        const retryBtn = document.getElementById('location-retry');
        if (!el || !textEl) return;
        textEl.textContent = text;
        el.classList.toggle('error', !!isError);
        el.classList.toggle('success', !isError && text.indexOf('Konum alındı') !== -1);
        if (text) el.classList.add('visible'); else el.classList.remove('visible');
        if (retryBtn) retryBtn.style.display = isError ? 'inline-block' : 'none';
    }

    function updateCoordsDisplay() {
        const el = document.getElementById('display-coords');
        if (el) {
            if (currentLat != null && currentLng != null) {
                el.textContent = currentLat.toFixed(6) + ' / ' + currentLng.toFixed(6);
            } else {
                el.textContent = '—';
            }
        }
    }

    function openModal() {
        const modal = document.getElementById('add-modal');
        if (!modal) return;
        updateCoordsDisplay();
        modal.hidden = false;
        modal.removeAttribute('aria-hidden');
        document.getElementById('input-location-name').focus();
        document.body.classList.add('modal-open');
    }

    function closeModal() {
        const modal = document.getElementById('add-modal');
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    function onGeolocationSuccess(position) {
        currentLat = position.coords.latitude;
        currentLng = position.coords.longitude;
        setLocationStatus('Konum alındı.', false);

        if (!userLocationMarker) {
            userLocationMarker = L.circleMarker([currentLat, currentLng], {
                radius: 10,
                fillColor: '#3b82f6',
                color: '#fff',
                weight: 2,
                fillOpacity: 0.9
            }).addTo(map);
        } else {
            userLocationMarker.setLatLng([currentLat, currentLng]);
        }
        map.setView([currentLat, currentLng], Math.max(map.getZoom(), 15));

        if (!modalShownAfterGps) {
            modalShownAfterGps = true;
            openModal();
        }
        updateCoordsDisplay();
    }

    function onGeolocationError(err) {
        const msg = err.code === 1 ? 'Konum izni verilmedi. Lütfen tarayıcı ayarlarından konuma izin verin.'
            : 'Konum alınamadı. Lütfen tekrar deneyin.';
        setLocationStatus(msg, true);
        currentLat = null;
        currentLng = null;
        updateCoordsDisplay();
    }

    function requestLocation() {
        setLocationStatus('Konum alınıyor...', false);
        if (!('geolocation' in navigator)) {
            setLocationStatus('Tarayıcınız konum desteklemiyor.', true);
            return;
        }
        navigator.geolocation.getCurrentPosition(onGeolocationSuccess, onGeolocationError, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        });
    }

    window.requestLocationAgain = requestLocation;
    var retryEl = document.getElementById('location-retry');
    if (retryEl) retryEl.addEventListener('click', requestLocation);

    function loadPanelLocations() {
        fetch('/api/panel-locations')
            .then(r => r.json())
            .then(data => {
                pointsLayer.clearLayers();
                data.forEach(function (p) {
                    const popupContent = document.createElement('div');
                    popupContent.className = 'map-popup-content';
                    popupContent.innerHTML =
                        '<div class="popup-title">' + escapeHtml(p.location_name) + '</div>' +
                        '<div class="popup-meta">Panel: ' + (p.panel_count || 1) + '</div>' +
                        (p.note ? '<div class="popup-note">' + escapeHtml(p.note) + '</div>' : '') +
                        '<div class="popup-time">' + new Date(p.created_at).toLocaleString('tr-TR') + '</div>' +
                        '<button type="button" class="popup-btn-delete" data-id="' + p.id + '">Sil</button>';
                    const marker = L.circleMarker([p.latitude, p.longitude], {
                        radius: 10,
                        fillColor: '#22c55e',
                        color: '#fff',
                        weight: 1,
                        fillOpacity: 0.8
                    }).bindPopup(popupContent);
                    popupContent.querySelector('.popup-btn-delete').addEventListener('click', function () {
                        if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
                        const id = this.getAttribute('data-id');
                        fetch('/api/panel-locations/' + id, { method: 'DELETE' })
                            .then(r => r.json())
                            .then(function (res) {
                                if (res.success) {
                                    marker.closePopup();
                                    loadPanelLocations();
                                }
                            });
                    });
                    marker.addTo(pointsLayer);
                });
            })
            .catch(function () {
                setLocationStatus('Kayıtlar yüklenemedi.', true);
            });
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    document.getElementById('btn-add-location').addEventListener('click', function () {
        if (currentLat != null && currentLng != null) {
            openModal();
        } else {
            setLocationStatus('Önce konum alınıyor...', false);
            requestLocation();
        }
    });

    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', closeModal);

    document.getElementById('add-form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (currentLat == null || currentLng == null) {
            alert('Konum bilgisi yok. Lütfen konum iznini verin ve tekrar deneyin.');
            return;
        }
        const nameInput = document.getElementById('input-location-name');
        const countInput = document.getElementById('input-panel-count');
        const noteInput = document.getElementById('input-note');
        const location_name = (nameInput && nameInput.value || '').trim();
        if (!location_name) {
            alert('Konum adı girin.');
            return;
        }
        const btn = document.getElementById('btn-save');
        if (btn) btn.disabled = true;
        fetch('/api/panel-locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_name: location_name,
                panel_count: parseInt(countInput && countInput.value, 10) || 1,
                latitude: currentLat,
                longitude: currentLng,
                note: (noteInput && noteInput.value || '').trim() || null
            })
        })
            .then(r => r.json())
            .then(function (res) {
                if (btn) btn.disabled = false;
                if (res.success) {
                    closeModal();
                    nameInput.value = '';
                    if (countInput) countInput.value = '1';
                    if (noteInput) noteInput.value = '';
                    loadPanelLocations();
                } else {
                    alert(res.error || 'Kayıt yapılamadı.');
                }
            })
            .catch(function () {
                if (btn) btn.disabled = false;
                alert('Bağlantı hatası.');
            });
    });

    requestLocation();
    loadPanelLocations();
})();
