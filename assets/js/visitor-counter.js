// visitor-counter.js — increments and displays the site-wide unique-per-day visitor count.
// Relies on firebase-app-compat.js, firebase-firestore-compat.js and config/firebase-visitor-config.js
// being loaded first.
(function () {
    'use strict';

    var STORAGE_KEY_PREFIX = 'rv_counted_';
    var COLLECTION = 'site_stats';
    var DOCUMENT = 'visitors';

    function todayKey() {
        var d = new Date();
        return STORAGE_KEY_PREFIX + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function animateCount(el, target) {
        var finalText = target.toLocaleString('en-US');
        var duration = 3000;
        var startTime = null;
        var done = false;

        function finish() {
            if (done) return;
            done = true;
            el.textContent = finalText;
        }

        function step(timestamp) {
            if (done) return;
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(target * eased).toLocaleString('en-US');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                finish();
            }
        }

        // requestAnimationFrame pauses in backgrounded/inactive tabs, so a
        // fallback timer guarantees the real value still renders.
        window.requestAnimationFrame(step);
        window.setTimeout(finish, duration + 400);
    }

    function initVisitorCounter() {
        var valueEl = document.getElementById('visitorCounterValue');
        if (!valueEl) return;

        var counterEl = document.getElementById('visitorCounter');

        if (typeof firebase === 'undefined' || !window.VISITOR_FIREBASE_CONFIG) {
            return;
        }

        var app;
        try {
            app = firebase.initializeApp(window.VISITOR_FIREBASE_CONFIG, 'visitor-counter');
        } catch (e) {
            console.error('[VisitorCounter] Firebase init failed:', e);
            return;
        }

        var db = app.firestore();
        var docRef = db.collection(COLLECTION).doc(DOCUMENT);

        var targetCount = null;
        var isInView = false;
        var animationStarted = false;
        var observer = null;

        function startAnimation() {
            if (animationStarted || targetCount === null || !isInView) return;
            animationStarted = true;
            animateCount(valueEl, targetCount);
            if (observer) {
                observer.disconnect();
            }
        }

        // Setup IntersectionObserver to only animate when in view
        if (counterEl && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        isInView = true;
                        startAnimation();
                    }
                });
            }, { threshold: 0.1 });
            observer.observe(counterEl);
        } else {
            // Fallback if IntersectionObserver is not supported
            isInView = true;
        }

        function handleFetchedValue(val) {
            targetCount = val;
            startAnimation();
        }

        if (localStorage.getItem(todayKey())) {
            docRef.get().then(function (snapshot) {
                if (snapshot.exists) {
                    handleFetchedValue(snapshot.data().total || 0);
                }
            }).catch(function (e) {
                console.error('[VisitorCounter] Read failed:', e);
            });
            return;
        }

        db.runTransaction(function (transaction) {
            return transaction.get(docRef).then(function (snapshot) {
                var next = (snapshot.exists ? (snapshot.data().total || 0) : 0) + 1;
                transaction.update(docRef, {
                    total: next,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                return next;
            });
        }).then(function (next) {
            localStorage.setItem(todayKey(), '1');
            handleFetchedValue(next);
        }).catch(function (e) {
            console.error('[VisitorCounter] Increment failed:', e);
            docRef.get().then(function (snapshot) {
                if (snapshot.exists) {
                    handleFetchedValue(snapshot.data().total || 0);
                }
            }).catch(function () {});
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVisitorCounter);
    } else {
        initVisitorCounter();
    }
})();
