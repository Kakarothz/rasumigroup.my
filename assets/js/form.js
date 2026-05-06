// ============================================
// RASUMI GROUP — FORM.JS
// Web3Forms contact form submission handler
// Get your free access key at: https://web3forms.com
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contactForm');
    if (!form) return;

    const submitBtn   = document.getElementById('submitBtn');
    const btnText     = submitBtn.querySelector('.btn-text');
    const btnLoading  = submitBtn.querySelector('.btn-loading');
    const successMsg  = document.getElementById('formSuccess');
    const errorMsg    = document.getElementById('formError');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Hide previous feedback
        successMsg.style.display = 'none';
        errorMsg.style.display   = 'none';

        // Show loading state
        btnText.style.display    = 'none';
        btnLoading.style.display = 'inline-flex';
        submitBtn.disabled       = true;

        const formData = new FormData(form);

        try {
            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                successMsg.style.display = 'flex';
                form.reset();
            } else {
                errorMsg.style.display = 'flex';
            }
        } catch (err) {
            errorMsg.style.display = 'flex';
        } finally {
            // Restore button
            btnText.style.display    = 'inline-flex';
            btnLoading.style.display = 'none';
            submitBtn.disabled       = false;
        }
    });
});

