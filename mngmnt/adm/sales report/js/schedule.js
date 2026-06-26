// ─────────────────────────────────────────────────────────────
// schedule.js — Schedule sync and tactical time picker
// ─────────────────────────────────────────────────────────────
APP.setupTacticalInputs = function () {
    const input = document.getElementById('sch-start');
    const apBtn = document.getElementById('sch-start-ap');

    if (apBtn) {
        apBtn.addEventListener('click', () => {
            apBtn.innerText = apBtn.innerText === 'AM' ? 'PM' : 'AM';
            apBtn.classList.add('active');
            document.getElementById('btn-sync-sch').classList.add('sync-alert');
        });
    }

    if (input) {
        input.addEventListener('input', () => {
            let val = input.value.replace(/[^0-9]/g, '');

            if (val.length === 1) {
                const firstDigit = parseInt(val);
                if (firstDigit >= 2 && firstDigit <= 9) input.value = `0${firstDigit}:`;
            } else if (val.length === 2) {
                input.value = `${val.slice(0, 2)}:`;
            } else if (val.length > 2) {
                input.value = `${val.slice(0, 2)}:${val.slice(2, 4)}`;
            }

            document.getElementById('btn-sync-sch').classList.add('sync-alert');
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && input.value.endsWith(':')) {
                input.value = input.value.slice(0, -1);
            }
        });
    }
};

APP.initScheduleSync = function () {
    const D = APP.DOM;
    if (!D.btnSyncSch) return;

    D.btnSyncSch.addEventListener('click', () => {
        if (!APP.state.activeDeviceId) return;

        const startVal = document.getElementById('sch-start').value.trim();
        const startAP  = document.getElementById('sch-start-ap').innerText.trim();

        // Validate format HH:MM before converting
        if (!/^\d{2}:\d{2}$/.test(startVal)) {
            logToTerminal('[ERROR] Invalid time format. Use HH:MM (e.g. 08:30).', 'error');
            return;
        }
        const [hStr, mStr] = startVal.split(':');
        const hInt12 = parseInt(hStr);
        const mInt   = parseInt(mStr);
        if (hInt12 < 1 || hInt12 > 12 || mInt < 0 || mInt > 59) {
            logToTerminal('[ERROR] Time out of range. Hours: 01-12, Minutes: 00-59.', 'error');
            return;
        }

        function to24(time12, ap) {
            let h = parseInt(time12.split(':')[0]);
            const m = time12.split(':')[1];
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return `${h.toString().padStart(2, '0')}:${m}`;
        }

        const reportTime = to24(startVal, startAP);
        D.btnSyncSch.classList.remove('sync-alert');
        logToTerminal(`[CMD] Setting Auto Report Time to ${reportTime} for Node [${APP.state.activeDeviceId}]...`, 'system');

        APP.db.collection('commands').doc(APP.state.activeDeviceId).set({
            action:    "UPDATE_REPORT_TIME",
            payload:   reportTime,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status:    "pending"
        }).then(() => {
            logToTerminal(`[CMD] REPORT_TIME_SYNC OK. Sent to Cloud.`, 'success');
            APP.db.collection('devices').doc(APP.state.activeDeviceId).update({ report_time: reportTime });
            APP.db.collection('admin_users').doc(APP.state.currentLoggedUser.email).update({
                cmds_sent: firebase.firestore.FieldValue.increment(1)
            });
        });
    });
};
