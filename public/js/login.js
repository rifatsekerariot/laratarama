(function () {
    'use strict';
    var form = document.getElementById('login-form');
    var errDiv = document.getElementById('error-msg');
    if (!form || !errDiv) return;

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var user = document.getElementById('username').value;
        var pass = document.getElementById('password').value;
        errDiv.style.display = 'none';

        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: user, pass: pass })
        })
            .then(function (res) {
                if (res.ok) {
                    window.location.href = '/';
                } else {
                    errDiv.style.display = 'block';
                    errDiv.innerText = 'Access Denied';
                }
            })
            .catch(function () {
                errDiv.style.display = 'block';
                errDiv.innerText = 'Server Error';
            });
    });
})();
