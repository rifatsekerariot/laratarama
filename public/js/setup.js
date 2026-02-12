(function () {
    'use strict';
    var form = document.getElementById('setup-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var domainEl = document.getElementById('domain_name');
        var payload = {
            appName: document.getElementById('app_name').value.trim(),
            adminUser: document.getElementById('admin_user').value.trim(),
            adminPass: document.getElementById('admin_pass').value,
            domainName: domainEl ? domainEl.value.trim() : ''
        };
        if (!payload.domainName) delete payload.domainName;

        fetch('/api/complete-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (res) {
                if (res.ok) {
                    alert('Kurulum Başarılı! Giriş ekranına yönlendiriliyorsunuz.');
                    window.location.href = '/login.html';
                } else {
                    return res.json().then(function (data) {
                        alert(data.error || 'Hata oluştu.');
                    }).catch(function () {
                        alert('Hata oluştu.');
                    });
                }
            })
            .catch(function () {
                alert('Bağlantı hatası.');
            });
    });
})();
