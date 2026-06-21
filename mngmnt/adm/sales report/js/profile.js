// ─────────────────────────────────────────────────────────────
// profile.js — Profile modal: avatar upload, password update, proof viewer
// ─────────────────────────────────────────────────────────────
APP.initProfile = function () {
    const D = APP.DOM;

    if (D.btnCloseProfile) D.btnCloseProfile.addEventListener('click', () => D.modalProfile.classList.add('hidden'));

    if (D.profileImgDisplay) D.profileImgDisplay.addEventListener('click', () => D.profileUpload.click());

    if (D.profileUpload) {
        D.profileUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate: image only, max 2MB
            if (!file.type.startsWith('image/')) {
                logToTerminal('[PROFILE] Upload rejected — image files only.', 'error');
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                logToTerminal('[PROFILE] Upload rejected — max file size is 2MB.', 'error');
                return;
            }

            const uid = APP.auth.currentUser.uid;
            const ref = APP.storage.ref(`avatars/${uid}/profile.jpg`);

            logToTerminal('[PROFILE] Uploading avatar...', 'info');

            const task = ref.put(file, { contentType: file.type });

            task.on('state_changed',
                null,
                (err) => {
                    logToTerminal(`[PROFILE] Upload failed: ${err.message}`, 'error');
                },
                () => {
                    task.snapshot.ref.getDownloadURL().then(url => {
                        return APP.db.collection('admin_users').doc(APP.auth.currentUser.email).update({
                            profile_img: url
                        }).then(() => {
                            // Update displayed avatar immediately
                            if (D.profileImgDisplay) D.profileImgDisplay.src = url;
                            const picEl = D.profileTrigger ? D.profileTrigger.querySelector('img') : null;
                            if (picEl) picEl.src = url;
                            logToTerminal('[PROFILE] Avatar updated successfully.', 'success');
                            // Reset input so same file can be re-uploaded if needed
                            e.target.value = '';
                        });
                    }).catch(err => {
                        logToTerminal(`[PROFILE] Failed to save avatar URL: ${err.message}`, 'error');
                    });
                }
            );
        });
    }

    if (D.btnUpdateProfile) {
        D.btnUpdateProfile.addEventListener('click', () => {
            const newPass     = D.pNewPass.value;
            const confirmPass = D.pConfirmPass.value;

            if (!newPass) { alert("Enter a new password to update."); return; }
            if (newPass !== confirmPass) { alert("Passwords mismatch!"); return; }
            if (newPass.length < 6) { alert("Password must be at least 6 characters."); return; }

            APP.auth.currentUser.updatePassword(newPass).then(() => {
                alert("Password updated successfully!");
                D.pNewPass.value     = '';
                D.pConfirmPass.value = '';
            }).catch(err => {
                alert("Error updating password: " + err.message);
            });
        });
    }

    if (D.btnProofClose) D.btnProofClose.addEventListener('click', () => D.proofViewer.classList.add('hidden'));
    if (D.proofClick)   D.proofClick.addEventListener('click', () => D.fsModal.classList.remove('hidden'));
    if (D.btnCloseFs)   D.btnCloseFs.addEventListener('click', () => D.fsModal.classList.add('hidden'));
};
