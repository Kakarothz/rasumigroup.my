// ─────────────────────────────────────────────────────────────
// modal.js — Cyber confirm modal engine
// ─────────────────────────────────────────────────────────────
APP.showCyberConfirm = function (title, message, type = 'primary') {
    const overlay   = document.getElementById('cyber-modal-overlay');
    const modal     = document.getElementById('active-cyber-modal');
    const titleEl   = document.getElementById('cyber-modal-title');
    const msgEl     = document.getElementById('cyber-modal-message');
    const btnCancel = document.getElementById('cyber-modal-cancel');
    const btnConfirm = document.getElementById('cyber-modal-confirm');

    modal.classList.remove('danger', 'warning');
    if (type === 'danger' || type === 'hazard') modal.classList.add('danger');
    if (type === 'warning') modal.classList.add('warning');

    titleEl.innerText = title;
    msgEl.innerText   = message;
    overlay.style.display = 'flex';

    return new Promise((resolve) => {
        const handleCancel = () => {
            overlay.style.display = 'none';
            btnCancel.removeEventListener('click', handleCancel);
            btnConfirm.removeEventListener('click', handleConfirm);
            resolve(false);
        };
        const handleConfirm = () => {
            overlay.style.display = 'none';
            btnCancel.removeEventListener('click', handleCancel);
            btnConfirm.removeEventListener('click', handleConfirm);
            resolve(true);
        };

        btnCancel.addEventListener('click', handleCancel);
        btnConfirm.addEventListener('click', handleConfirm);
    });
};
